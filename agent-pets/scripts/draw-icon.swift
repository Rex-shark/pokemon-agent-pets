// 畫寶可夢牧場的 App 圖示：綠色圓角方形底（macOS 圖示格線：1024 畫布、824 方塊）＋中間一顆精靈球。
// 用法：swift draw-icon.swift <輸出的 png>
import AppKit
import CoreGraphics

let size = 1024
let out = CommandLine.arguments[1]
let cs = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
// CoreGraphics 原點在左下；下面的座標都以左下為原點
func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
  CGColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: a)
}
func gradient(_ colors: [CGColor], _ locs: [CGFloat]) -> CGGradient {
  CGGradient(colorsSpace: cs, colors: colors as CFArray, locations: locs)!
}

// ── 底：圓角方形（略帶陰影），草地綠的上下漸層 ──
let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
let tilePath = CGPath(roundedRect: tile, cornerWidth: 186, cornerHeight: 186, transform: nil)
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: rgb(0x000000, 0.28))
ctx.addPath(tilePath)
ctx.setFillColor(rgb(0x6aa654))
ctx.fillPath()
ctx.restoreGState()
ctx.saveGState()
ctx.addPath(tilePath)
ctx.clip()
ctx.drawLinearGradient(gradient([rgb(0x9fd27e), rgb(0x5f9a4a)], [0, 1]),
                       start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
// 下方一片淡淡的深色草地，像小島
ctx.setFillColor(rgb(0x4f8a3e, 0.35))
ctx.fillEllipse(in: CGRect(x: 170, y: 150, width: 684, height: 190))
ctx.restoreGState()

// ── 精靈球 ──
let c = CGPoint(x: 512, y: 540)
let R: CGFloat = 300
let ball = CGRect(x: c.x - R, y: c.y - R, width: 2 * R, height: 2 * R)
// 落在地上的影子
ctx.setFillColor(rgb(0x2f5a26, 0.35))
ctx.fillEllipse(in: CGRect(x: c.x - R * 0.82, y: c.y - R - 46, width: R * 1.64, height: 70))

ctx.saveGState()
ctx.addEllipse(in: ball)
ctx.clip()
// 上半紅、下半白（各自漸層，帶一點立體感）
ctx.saveGState()
ctx.clip(to: CGRect(x: c.x - R, y: c.y, width: 2 * R, height: R))
ctx.drawRadialGradient(gradient([rgb(0xff6b5e), rgb(0xe23b30), rgb(0xa91e1a)], [0, 0.55, 1]),
                       startCenter: CGPoint(x: c.x - R * 0.35, y: c.y + R * 0.55), startRadius: 0,
                       endCenter: c, endRadius: R * 1.15, options: [.drawsAfterEndLocation])
ctx.restoreGState()
ctx.saveGState()
ctx.clip(to: CGRect(x: c.x - R, y: c.y - R, width: 2 * R, height: R))
ctx.drawRadialGradient(gradient([rgb(0xffffff), rgb(0xeef0f3), rgb(0xb9bec6)], [0, 0.55, 1]),
                       startCenter: CGPoint(x: c.x - R * 0.35, y: c.y + R * 0.2), startRadius: 0,
                       endCenter: c, endRadius: R * 1.15, options: [.drawsAfterEndLocation])
ctx.restoreGState()
// 中間的黑帶
let band: CGFloat = R * 0.16
ctx.setFillColor(rgb(0x1f2226))
ctx.fill(CGRect(x: c.x - R, y: c.y - band / 2, width: 2 * R, height: band))
ctx.restoreGState()

// 外框
ctx.setStrokeColor(rgb(0x1f2226))
ctx.setLineWidth(R * 0.075)
ctx.strokeEllipse(in: ball.insetBy(dx: R * 0.0375, dy: R * 0.0375))

// 中間的按鈕：黑圈 → 白圈 → 細框
let b1: CGFloat = R * 0.33
ctx.setFillColor(rgb(0x1f2226))
ctx.fillEllipse(in: CGRect(x: c.x - b1, y: c.y - b1, width: 2 * b1, height: 2 * b1))
let b2: CGFloat = R * 0.22
ctx.saveGState()
ctx.addEllipse(in: CGRect(x: c.x - b2, y: c.y - b2, width: 2 * b2, height: 2 * b2))
ctx.clip()
ctx.drawRadialGradient(gradient([rgb(0xffffff), rgb(0xdfe3e8)], [0, 1]),
                       startCenter: CGPoint(x: c.x - b2 * 0.3, y: c.y + b2 * 0.3), startRadius: 0,
                       endCenter: c, endRadius: b2, options: [])
ctx.restoreGState()
let b3: CGFloat = R * 0.13
ctx.setStrokeColor(rgb(0xc3c8cf))
ctx.setLineWidth(R * 0.025)
ctx.strokeEllipse(in: CGRect(x: c.x - b3, y: c.y - b3, width: 2 * b3, height: 2 * b3))

// 紅色上的亮面
ctx.saveGState()
ctx.translateBy(x: c.x - R * 0.42, y: c.y + R * 0.52)
ctx.rotate(by: 0.6)
ctx.setFillColor(rgb(0xffffff, 0.45))
ctx.fillEllipse(in: CGRect(x: -R * 0.2, y: -R * 0.09, width: R * 0.4, height: R * 0.18))
ctx.restoreGState()

let img = ctx.makeImage()!
let rep = NSBitmapImageRep(cgImage: img)
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
