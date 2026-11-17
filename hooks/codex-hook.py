#!/usr/bin/env python3
"""把 Codex 原生 hook 轉成牧場事件；只使用 Python 標準函式庫。"""

import argparse
import http.client
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys


EVENTS = (
    "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse",
    "PermissionRequest", "SubagentStart", "SubagentStop", "PreCompact",
    "PostCompact", "Stop", "Interrupt", "SessionEnd",
)
MAX_INPUT = 10 * 1024 * 1024
TOOL_NAMES = {
    "exec_command": "Bash", "shell_command": "Bash", "shell": "Bash",
    "apply_patch": "Edit", "spawn_agent": "Agent",
    "request_user_input": "AskUserQuestion", "request_user_input_async": "AskUserQuestion",
}


def short_text(value, limit=80):
    if not isinstance(value, str):
        return None
    text = " ".join("".join(c if c.isprintable() else " " for c in value).split())
    return text[:limit] or None


def normalize(raw, title=None):
    """白名單轉送：提示、回覆、patch、指令與工具輸出都不離開這個程序。"""
    if not isinstance(raw, dict):
        return None
    session_id = raw.get("session_id")
    event = raw.get("hook_event_name")
    if not isinstance(session_id, str) or not session_id.strip() or event not in EVENTS:
        return None
    if event == "SessionStart" and raw.get("source") == "compact":
        event = "PostCompact"
    result = {"provider": "codex", "session_id": session_id, "hook_event_name": event}
    for key in ("cwd", "agent_id", "agent_type"):
        value = raw.get(key)
        if isinstance(value, str) and value:
            result[key] = value
    if display_title := short_text(title):
        result["session_title"] = display_title

    tool = raw.get("tool_name")
    if isinstance(tool, str) and tool:
        # 兼容直接呼叫本地工具時的 functions.* 名稱；MCP 名稱原樣保留。
        canonical = tool.removeprefix("functions.")
        tool = TOOL_NAMES.get(canonical, canonical)
        result["tool_name"] = tool
        args = raw.get("tool_input")
        args = args if isinstance(args, dict) else {}
        if tool in ("Bash", "Agent"):
            if description := short_text(args.get("description"), 20):
                result["tool_input"] = {"description": description}
        elif tool == "AskUserQuestion":
            questions = args.get("questions")
            first = questions[0] if isinstance(questions, list) and questions else None
            if isinstance(first, dict) and (header := short_text(first.get("header"), 20)):
                result["tool_input"] = {"questions": [{"header": header}]}

    # Codex 用 PostToolUse 回報失敗；只有結構化錯誤才判定失敗，不能從任意輸出文字猜。
    response = raw.get("tool_response")
    if event == "PostToolUse" and isinstance(response, dict):
        code = response.get("exit_code")
        failed = response.get("isError") is True or (type(code) is int and code != 0)
        if failed:
            result["hook_event_name"] = "PostToolUseFailure"
    return result


def send(event, port):
    # 固定 loopback、不讀 proxy 設定、不跟隨重新導向；整次請求最多等 1 秒左右。
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
    try:
        body = json.dumps(event, ensure_ascii=False).encode("utf-8")
        connection.request("POST", "/hook", body, {"Content-Type": "application/json"})
        connection.getresponse().close()
    finally:
        connection.close()


def hook_config(port, title):
    # 絕對路徑＋shell quoting：Desktop 的 PATH 與終端機可能不同，路徑也可能有空白。
    args = [sys.executable, "-I", str(Path(__file__).resolve()), "--port", str(port)]
    if title:
        args.extend(["--title", title])
    # Windows 的 hook 指令交給 CreateProcess／cmd 解析，要用雙引號；macOS、Linux 用 POSIX shell quoting。
    command = subprocess.list2cmdline(args) if os.name == "nt" else shlex.join(args)
    return {"hooks": {event: [{"hooks": [{"type": "command", "command": command, "timeout": 3}]}]
                      for event in EVENTS}}


def main():
    parser = argparse.ArgumentParser(description="Codex → 寶可夢牧場（不會自動安裝 hooks）")
    parser.add_argument("--port", type=int, help="牧場 port；預設 PET_HOOK_PORT 或 47821")
    parser.add_argument("--title", help="顯示名稱；預設 PET_SESSION_TITLE，未指定時顯示專案目錄名稱")
    parser.add_argument("--print-config", action="store_true", help="輸出可合併到 ~/.codex/hooks.json 的設定")
    parser.add_argument("--dry-run", action="store_true", help="只印出轉換結果，不傳送事件")
    args = parser.parse_args()
    # Windows 的 stdout 預設是系統編碼（cp950）＋CRLF：中文標題會印不出來，換行也跟 macOS 不同；統一成 UTF-8＋LF。
    try:
        sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    except (AttributeError, ValueError):
        pass
    try:
        port = args.port if args.port is not None else int(os.environ.get("PET_HOOK_PORT", "47821"))
        if not 1 <= port <= 65535:
            raise ValueError("port 必須介於 1 與 65535")
        title = args.title if args.title is not None else os.environ.get("PET_SESSION_TITLE")
        if args.print_config:
            print(json.dumps(hook_config(port, title), ensure_ascii=False, indent=2))
            return
        body = sys.stdin.buffer.read(MAX_INPUT + 1)
        if len(body) > MAX_INPUT:
            raise ValueError("事件太大")
        event = normalize(json.loads(body), title)
        if args.dry_run:
            print(json.dumps(event, ensure_ascii=False, indent=2))
            return
        if event:
            send(event, port)
    except Exception as error:
        if args.print_config or args.dry_run:
            parser.exit(1, f"{error}\n")
        # 桌寵沒開、事件不完整或送出失敗，都不妨礙 Codex 工作。
    # Stop/SubagentStop 要求 JSON；空物件不決定權限、不加入提示、不延長回合。
    print("{}")


if __name__ == "__main__":
    main()
