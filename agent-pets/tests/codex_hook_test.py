"""轉接器契約與離線行為；不用 Codex 帳號，也不碰真正的牧場。"""
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import sys
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / "hooks" / "codex-hook.py"
spec = importlib.util.spec_from_file_location("codex_hook", SCRIPT)
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)


class CodexHookTests(unittest.TestCase):
    def event(self, name="PreToolUse", **fields):
        return {"session_id": "thread-1", "hook_event_name": name, **fields}

    def test_privacy_and_tool_mapping(self):
        result = hook.normalize(self.event(
            tool_name="functions.exec_command",
            tool_input={"command": "echo SECRET", "description": "執行檢查"},
            prompt="PRIVATE PROMPT", last_assistant_message="PRIVATE REPLY",
            transcript_path="/private/transcript", tool_response="PRIVATE OUTPUT",
        ))
        self.assertEqual(result, {
            "provider": "codex", "session_id": "thread-1", "hook_event_name": "PreToolUse",
            "tool_name": "Bash", "tool_input": {"description": "執行檢查"},
        })

    def test_patch_not_forwarded(self):
        result = hook.normalize(self.event(tool_name="apply_patch", tool_input={"command": "SECRET PATCH"}))
        self.assertEqual(result["tool_name"], "Edit")
        self.assertNotIn("tool_input", result)

    def test_question_header_only(self):
        result = hook.normalize(self.event(tool_name="request_user_input", tool_input={
            "questions": [{"header": "選擇方式", "question": "PRIVATE", "options": ["PRIVATE"]}]}))
        self.assertEqual(result["tool_name"], "AskUserQuestion")
        self.assertEqual(result["tool_input"], {"questions": [{"header": "選擇方式"}]})

    def test_structured_failures_only(self):
        for response in ({"exit_code": 1}, {"isError": True}):
            result = hook.normalize(self.event("PostToolUse", tool_response=response))
            self.assertEqual(result["hook_event_name"], "PostToolUseFailure")
            self.assertNotIn("tool_response", result)
        for response in ({"exit_code": 0}, {"exit_code": True}, "error", {"content": "error"}):
            self.assertEqual(hook.normalize(self.event("PostToolUse", tool_response=response))["hook_event_name"], "PostToolUse")

    def test_compaction_and_interrupt(self):
        self.assertEqual(hook.normalize(self.event("SessionStart", source="compact"))["hook_event_name"], "PostCompact")
        self.assertEqual(hook.normalize(self.event("Interrupt"))["hook_event_name"], "Interrupt")

    def test_subagent_uses_parent_session(self):
        result = hook.normalize(self.event("SubagentStart", agent_id="child", agent_type="worker"))
        self.assertEqual(result["session_id"], "thread-1")
        self.assertEqual(result["agent_id"], "child")

    def test_invalid_events(self):
        for value in (None, [], {}, {"session_id": " ", "hook_event_name": "Stop"}, self.event("Unknown")):
            self.assertIsNone(hook.normalize(value))

    def test_title_is_explicit_and_bounded(self):
        self.assertNotIn("session_title", hook.normalize(self.event(prompt="do not use")))
        self.assertEqual(hook.normalize(self.event(), "  測試\n專案  ")["session_title"], "測試 專案")
        self.assertEqual(len(hook.normalize(self.event(), "字" * 100)["session_title"]), 80)

    def test_config_has_supported_events_and_quoted_command(self):
        config = hook.hook_config(47899, "測試 ' $() ` 空白")
        self.assertEqual(set(config["hooks"]), set(hook.EVENTS))
        self.assertNotIn("PostToolUseFailure", config["hooks"])
        for rules in config["hooks"].values():
            handler = rules[0]["hooks"][0]
            args = hook.shlex.split(handler["command"])
            self.assertEqual(args[-2:], ["--title", "測試 ' $() ` 空白"])
            self.assertEqual(handler["timeout"], 3)
            self.assertNotIn("async", handler)

    def test_offline_and_invalid_input_do_not_block_codex(self):
        # 保留未 listen 的隨機 port，確保不是使用者正在開的服務。
        with socket.socket() as reserved:
            reserved.bind(("127.0.0.1", 0))
            port = str(reserved.getsockname()[1])
            for body in (json.dumps(self.event("Stop")), "invalid JSON"):
                result = subprocess.run([sys.executable, "-I", str(SCRIPT), "--port", port],
                                        input=body, text=True, capture_output=True, timeout=3)
                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "{}\n")
                self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
