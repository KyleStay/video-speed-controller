#!/usr/bin/env swift

import AppKit
import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let output = root.appendingPathComponent("store-assets/chrome", isDirectory: true)
let iconURL = root.appendingPathComponent("src/assets/icons/stayfast-mark.svg")

guard let icon = NSImage(contentsOf: iconURL) else {
  fatalError("Could not load \(iconURL.path)")
}

func color(_ hex: UInt32, alpha: CGFloat = 1) -> NSColor {
  NSColor(
    red: CGFloat((hex >> 16) & 0xff) / 255,
    green: CGFloat((hex >> 8) & 0xff) / 255,
    blue: CGFloat(hex & 0xff) / 255,
    alpha: alpha
  )
}

let navy = color(0x0B2238)
let deepNavy = color(0x071725)
let cyan = color(0x39D5F6)
let paleCyan = color(0xA7F0FF)
let ink = color(0x10283A)
let muted = color(0x60768A)
let paper = color(0xF6FAFC)

func rounded(_ rect: NSRect, radius: CGFloat, fill: NSColor, stroke: NSColor? = nil, width: CGFloat = 1) {
  let path = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
  fill.setFill()
  path.fill()
  if let stroke {
    stroke.setStroke()
    path.lineWidth = width
    path.stroke()
  }
}

func text(
  _ value: String,
  in rect: NSRect,
  size: CGFloat,
  weight: NSFont.Weight = .regular,
  color: NSColor = .white,
  alignment: NSTextAlignment = .left
) {
  let style = NSMutableParagraphStyle()
  style.alignment = alignment
  style.lineBreakMode = .byWordWrapping
  let attributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: size, weight: weight),
    .foregroundColor: color,
    .paragraphStyle: style,
  ]
  (value as NSString).draw(in: rect, withAttributes: attributes)
}

func line(from start: NSPoint, to end: NSPoint, color: NSColor, width: CGFloat) {
  let path = NSBezierPath()
  path.move(to: start)
  path.line(to: end)
  path.lineWidth = width
  path.lineCapStyle = .round
  color.setStroke()
  path.stroke()
}

func drawIcon(in rect: NSRect) {
  NSGraphicsContext.current?.imageInterpolation = .high
  icon.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1)
}

func saveFile(url: URL, width: Int, height: Int, draw: (NSRect) -> Void) throws {
  let image = NSImage(size: NSSize(width: width, height: height))
  image.lockFocus()
  draw(NSRect(x: 0, y: 0, width: width, height: height))
  image.unlockFocus()

  guard
    let tiff = image.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiff),
    let png = bitmap.representation(using: .png, properties: [:])
  else {
    fatalError("Could not encode \(url.lastPathComponent)")
  }
  try png.write(to: url, options: .atomic)
}

func save(name: String, width: Int, height: Int, draw: (NSRect) -> Void) throws {
  try saveFile(url: output.appendingPathComponent(name), width: width, height: height, draw: draw)
}

func drawBackground(_ bounds: NSRect) {
  NSGradient(colors: [deepNavy, navy, color(0x0E4660)])!.draw(in: bounds, angle: 0)
  let glow = NSBezierPath(ovalIn: NSRect(x: bounds.maxX * 0.62, y: -bounds.height * 0.42, width: bounds.height * 1.25, height: bounds.height * 1.25))
  color(0x26CBEF, alpha: 0.14).setFill()
  glow.fill()
}

func drawSpeedLines(_ bounds: NSRect, y: CGFloat) {
  line(from: NSPoint(x: bounds.width * 0.08, y: y + 30), to: NSPoint(x: bounds.width * 0.29, y: y + 30), color: color(0x8CEAFF, alpha: 0.42), width: 5)
  line(from: NSPoint(x: bounds.width * 0.04, y: y), to: NSPoint(x: bounds.width * 0.25, y: y), color: color(0x8CEAFF, alpha: 0.24), width: 4)
  line(from: NSPoint(x: bounds.width * 0.72, y: y + 30), to: NSPoint(x: bounds.width * 0.93, y: y + 30), color: color(0x8CEAFF, alpha: 0.42), width: 5)
  line(from: NSPoint(x: bounds.width * 0.76, y: y), to: NSPoint(x: bounds.width * 0.97, y: y), color: color(0x8CEAFF, alpha: 0.24), width: 4)
}

// Chrome recommends 96×96 square artwork centered in the required 128×128 PNG.
try saveFile(
  url: root.appendingPathComponent("src/assets/icons/icon128.png"),
  width: 128,
  height: 128
) { _ in
  drawIcon(in: NSRect(x: 16, y: 16, width: 96, height: 96))
}

try save(name: "small-promo-440x280.png", width: 440, height: 280) { bounds in
  drawBackground(bounds)
  drawSpeedLines(bounds, y: 67)
  rounded(NSRect(x: 151, y: 72, width: 138, height: 138), radius: 33, fill: color(0x06131F, alpha: 0.34), stroke: color(0x7BE8FF, alpha: 0.16), width: 1)
  drawIcon(in: NSRect(x: 168, y: 89, width: 104, height: 104))
  text("STAYFAST VIDEO", in: NSRect(x: 20, y: 31, width: 400, height: 24), size: 15, weight: .semibold, color: paleCyan, alignment: .center)
}

try save(name: "marquee-promo-1400x560.png", width: 1400, height: 560) { bounds in
  drawBackground(bounds)
  for index in 0..<5 {
    let x = CGFloat(65 + index * 70)
    line(from: NSPoint(x: x, y: 250), to: NSPoint(x: x + 150, y: 250), color: color(0x75E5FF, alpha: CGFloat(0.08 + Double(index) * 0.035)), width: 8)
  }
  rounded(NSRect(x: 203, y: 136, width: 288, height: 288), radius: 65, fill: color(0x06131F, alpha: 0.3), stroke: color(0x83EBFF, alpha: 0.15), width: 2)
  drawIcon(in: NSRect(x: 241, y: 174, width: 212, height: 212))
  text("StayFast Video", in: NSRect(x: 574, y: 280, width: 650, height: 88), size: 64, weight: .bold, color: .white)
  text("Every video. Your speed.", in: NSRect(x: 579, y: 210, width: 650, height: 58), size: 32, weight: .medium, color: paleCyan)
  rounded(NSRect(x: 579, y: 140, width: 124, height: 46), radius: 23, fill: color(0x43D9F7, alpha: 0.16), stroke: color(0x64E4FF, alpha: 0.38), width: 1)
  text("0.07×", in: NSRect(x: 579, y: 151, width: 124, height: 28), size: 18, weight: .semibold, color: paleCyan, alignment: .center)
  rounded(NSRect(x: 718, y: 140, width: 124, height: 46), radius: 23, fill: color(0x43D9F7, alpha: 0.16), stroke: color(0x64E4FF, alpha: 0.38), width: 1)
  text("16×", in: NSRect(x: 718, y: 151, width: 124, height: 28), size: 18, weight: .semibold, color: paleCyan, alignment: .center)
}

func drawBrowserFrame(_ bounds: NSRect, title: String) -> NSRect {
  let frame = NSRect(x: 54, y: 62, width: bounds.width - 108, height: bounds.height - 124)
  rounded(frame, radius: 22, fill: .white, stroke: color(0xC7D5DF), width: 1)
  let chrome = NSRect(x: frame.minX, y: frame.maxY - 68, width: frame.width, height: 68)
  let chromePath = NSBezierPath(roundedRect: chrome, xRadius: 22, yRadius: 22)
  color(0xEAF1F5).setFill()
  chromePath.fill()
  color(0xEAF1F5).setFill()
  NSBezierPath(rect: NSRect(x: chrome.minX, y: chrome.minY, width: chrome.width, height: 25)).fill()
  for (index, c) in [color(0xFF6B65), color(0xF6C453), color(0x56C56F)].enumerated() {
    c.setFill()
    NSBezierPath(ovalIn: NSRect(x: frame.minX + 22 + CGFloat(index * 25), y: frame.maxY - 41, width: 12, height: 12)).fill()
  }
  rounded(NSRect(x: frame.minX + 132, y: frame.maxY - 50, width: frame.width - 164, height: 33), radius: 16, fill: .white)
  text(title, in: NSRect(x: frame.minX + 153, y: frame.maxY - 42, width: frame.width - 210, height: 22), size: 13, color: muted)
  return NSRect(x: frame.minX, y: frame.minY, width: frame.width, height: frame.height - 68)
}

try save(name: "screenshot-1-control-1280x800.png", width: 1280, height: 800) { bounds in
  color(0xE7F2F7).setFill()
  NSBezierPath(rect: bounds).fill()
  let page = drawBrowserFrame(bounds, title: "Your video — StayFast Video active")
  NSGradient(colors: [color(0x123C58), color(0x266F84), color(0x79C9D0)])!.draw(in: page, angle: 90)
  color(0x173D39, alpha: 0.9).setFill()
  let hill = NSBezierPath()
  hill.move(to: NSPoint(x: page.minX, y: page.minY))
  hill.line(to: NSPoint(x: page.minX, y: page.minY + 165))
  hill.curve(to: NSPoint(x: page.maxX, y: page.minY + 90), controlPoint1: NSPoint(x: page.minX + 330, y: page.minY + 300), controlPoint2: NSPoint(x: page.maxX - 350, y: page.minY - 10))
  hill.line(to: NSPoint(x: page.maxX, y: page.minY))
  hill.close()
  hill.fill()
  rounded(NSRect(x: page.minX + 35, y: page.maxY - 84, width: 108, height: 47), radius: 10, fill: color(0x06131F, alpha: 0.78), stroke: color(0x79E9FF, alpha: 0.7), width: 1)
  text("1.75×", in: NSRect(x: page.minX + 35, y: page.maxY - 73, width: 108, height: 30), size: 21, weight: .bold, color: .white, alignment: .center)
  let card = NSRect(x: page.maxX - 445, y: page.minY + 58, width: 385, height: 230)
  rounded(card, radius: 22, fill: color(0x071725, alpha: 0.9), stroke: color(0x75E5FF, alpha: 0.25), width: 1)
  text("Control every video", in: NSRect(x: card.minX + 30, y: card.maxY - 73, width: card.width - 60, height: 40), size: 30, weight: .bold)
  text("Change speed, seek precisely, set markers, and step frame by frame with custom shortcuts.", in: NSRect(x: card.minX + 30, y: card.minY + 68, width: card.width - 60, height: 95), size: 18, weight: .regular, color: color(0xD2EDF4))
  text("0.07×  —  16×", in: NSRect(x: card.minX + 30, y: card.minY + 31, width: card.width - 60, height: 27), size: 18, weight: .semibold, color: cyan)
}

try save(name: "screenshot-2-popup-1280x800.png", width: 1280, height: 800) { bounds in
  NSGradient(colors: [color(0xEAF5F8), color(0xD4EAF1)])!.draw(in: bounds, angle: 90)
  text("Playback control, one click away", in: NSRect(x: 70, y: 600, width: 680, height: 72), size: 39, weight: .bold, color: ink)
  text("Use quick presets, fine adjustments, or any custom speed from the toolbar popup.", in: NSRect(x: 73, y: 485, width: 560, height: 98), size: 24, color: muted)
  let popup = NSRect(x: 760, y: 88, width: 410, height: 624)
  rounded(popup, radius: 24, fill: color(0xF9FCFD), stroke: color(0xB9CCD7), width: 1)
  rounded(NSRect(x: popup.minX, y: popup.maxY - 110, width: popup.width, height: 110), radius: 24, fill: navy)
  color(0xF9FCFD).setFill()
  NSBezierPath(rect: NSRect(x: popup.minX, y: popup.maxY - 110, width: popup.width, height: 24)).fill()
  drawIcon(in: NSRect(x: popup.minX + 28, y: popup.maxY - 86, width: 58, height: 58))
  text("StayFast Video", in: NSRect(x: popup.minX + 101, y: popup.maxY - 67, width: 220, height: 30), size: 20, weight: .bold)
  text("Every video. Your speed.", in: NSRect(x: popup.minX + 101, y: popup.maxY - 92, width: 250, height: 24), size: 13, color: paleCyan)
  text("PLAYBACK SPEED", in: NSRect(x: popup.minX + 30, y: popup.maxY - 151, width: 210, height: 22), size: 12, weight: .semibold, color: muted)
  let controlsY = popup.maxY - 235
  for (index, label) in ["−0.1", "1×", "+0.1"].enumerated() {
    let x = popup.minX + 30 + CGFloat(index) * 122
    rounded(NSRect(x: x, y: controlsY, width: 105, height: 58), radius: 12, fill: index == 1 ? navy : .white, stroke: color(0xB7CAD5), width: 1)
    text(label, in: NSRect(x: x, y: controlsY + 18, width: 105, height: 26), size: 18, weight: .semibold, color: index == 1 ? .white : ink, alignment: .center)
  }
  let presets = ["0.5", "0.75", "1", "1.25", "1.5", "1.75", "2", "2.5"]
  for index in 0..<presets.count {
    let col = index % 4
    let row = index / 4
    let x = popup.minX + 30 + CGFloat(col) * 91
    let y = controlsY - 82 - CGFloat(row) * 64
    rounded(NSRect(x: x, y: y, width: 77, height: 48), radius: 10, fill: presets[index] == "1.75" ? color(0xC9F5FF) : .white, stroke: presets[index] == "1.75" ? cyan : color(0xC4D3DC), width: 1)
    text(presets[index], in: NSRect(x: x, y: y + 14, width: 77, height: 24), size: 15, weight: .medium, color: ink, alignment: .center)
  }
  text("CUSTOM", in: NSRect(x: popup.minX + 30, y: controlsY - 243, width: 100, height: 20), size: 12, weight: .semibold, color: muted)
  rounded(NSRect(x: popup.minX + 30, y: controlsY - 302, width: 235, height: 48), radius: 10, fill: .white, stroke: color(0xC4D3DC), width: 1)
  text("1.33", in: NSRect(x: popup.minX + 47, y: controlsY - 288, width: 110, height: 24), size: 16, color: muted)
  rounded(NSRect(x: popup.minX + 278, y: controlsY - 302, width: 102, height: 48), radius: 10, fill: cyan)
  text("Set", in: NSRect(x: popup.minX + 278, y: controlsY - 288, width: 102, height: 24), size: 16, weight: .bold, color: navy, alignment: .center)
  rounded(NSRect(x: 72, y: 329, width: 188, height: 48), radius: 24, fill: navy)
  text("0.07× to 16×", in: NSRect(x: 72, y: 342, width: 188, height: 28), size: 17, weight: .semibold, alignment: .center)
  rounded(NSRect(x: 275, y: 329, width: 200, height: 48), radius: 24, fill: color(0xC5F4FE))
  text("Private by design", in: NSRect(x: 275, y: 342, width: 200, height: 28), size: 17, weight: .semibold, color: navy, alignment: .center)
}

try save(name: "screenshot-3-settings-1280x800.png", width: 1280, height: 800) { bounds in
  color(0xEDF4F7).setFill()
  NSBezierPath(rect: bounds).fill()
  let page = NSRect(x: 48, y: 43, width: 1184, height: 714)
  rounded(page, radius: 22, fill: .white, stroke: color(0xC8D7DF), width: 1)
  rounded(NSRect(x: page.minX, y: page.maxY - 88, width: page.width, height: 88), radius: 22, fill: navy)
  NSColor.white.setFill()
  NSBezierPath(rect: NSRect(x: page.minX, y: page.maxY - 88, width: page.width, height: 22)).fill()
  drawIcon(in: NSRect(x: page.minX + 28, y: page.maxY - 69, width: 48, height: 48))
  text("StayFast Video", in: NSRect(x: page.minX + 92, y: page.maxY - 55, width: 230, height: 30), size: 21, weight: .bold)
  for (index, tab) in ["Settings", "Advanced", "FAQ", "About"].enumerated() {
    let x = page.minX + 405 + CGFloat(index) * 125
    text(tab, in: NSRect(x: x, y: page.maxY - 56, width: 110, height: 27), size: 15, weight: index == 0 ? .semibold : .regular, color: index == 0 ? cyan : color(0xB9CDD8), alignment: .center)
    if index == 0 { rounded(NSRect(x: x + 18, y: page.maxY - 71, width: 74, height: 3), radius: 2, fill: cyan) }
  }
  rounded(NSRect(x: page.maxX - 128, y: page.maxY - 64, width: 88, height: 40), radius: 10, fill: cyan)
  text("Save", in: NSRect(x: page.maxX - 128, y: page.maxY - 53, width: 88, height: 24), size: 15, weight: .bold, color: navy, alignment: .center)
  text("Shortcuts", in: NSRect(x: page.minX + 48, y: page.maxY - 145, width: 310, height: 38), size: 27, weight: .bold, color: ink)
  let rows = [("S", "Decrease speed", "0.1"), ("D", "Increase speed", "0.1"), ("Z", "Rewind", "10 sec"), ("X", "Advance", "10 sec"), (",", "Step back one frame", "30 fps"), (".", "Step forward one frame", "30 fps")]
  for (index, row) in rows.enumerated() {
    let y = page.maxY - 206 - CGFloat(index) * 66
    rounded(NSRect(x: page.minX + 48, y: y, width: 532, height: 54), radius: 12, fill: index % 2 == 0 ? color(0xF4F8FA) : .white, stroke: color(0xD7E2E8), width: 1)
    rounded(NSRect(x: page.minX + 64, y: y + 9, width: 44, height: 36), radius: 8, fill: navy)
    text(row.0, in: NSRect(x: page.minX + 64, y: y + 18, width: 44, height: 22), size: 15, weight: .bold, alignment: .center)
    text(row.1, in: NSRect(x: page.minX + 128, y: y + 16, width: 275, height: 26), size: 16, weight: .medium, color: ink)
    text(row.2, in: NSRect(x: page.minX + 408, y: y + 16, width: 135, height: 26), size: 15, color: muted, alignment: .right)
  }
  text("Preferences", in: NSRect(x: page.minX + 630, y: page.maxY - 145, width: 310, height: 38), size: 27, weight: .bold, color: ink)
  let preferences = [("Audio support", true), ("Remember playback speed", false), ("Hide controller by default", false), ("Exclusive keyboard shortcuts", true)]
  for (index, preference) in preferences.enumerated() {
    let y = page.maxY - 213 - CGFloat(index) * 84
    text(preference.0, in: NSRect(x: page.minX + 630, y: y + 14, width: 330, height: 28), size: 17, weight: .medium, color: ink)
    rounded(NSRect(x: page.maxX - 124, y: y + 11, width: 58, height: 32), radius: 16, fill: preference.1 ? cyan : color(0xCAD7DE))
    let knobX = preference.1 ? page.maxX - 96 : page.maxX - 120
    color(0xFFFFFF).setFill()
    NSBezierPath(ovalIn: NSRect(x: knobX, y: y + 14, width: 26, height: 26)).fill()
    line(from: NSPoint(x: page.minX + 630, y: y - 7), to: NSPoint(x: page.maxX - 64, y: y - 7), color: color(0xE2EAEE), width: 1)
  }
  rounded(NSRect(x: page.minX + 630, y: page.minY + 68, width: page.width - 696, height: 118), radius: 16, fill: color(0xEAF9FC), stroke: color(0xB9ECF6), width: 1)
  text("Make it yours", in: NSRect(x: page.minX + 656, y: page.minY + 129, width: 300, height: 30), size: 20, weight: .bold, color: ink)
  text("Customize keys, speed values, site rules, controller appearance, and more.", in: NSRect(x: page.minX + 656, y: page.minY + 87, width: page.width - 750, height: 45), size: 16, color: muted)
}

print("Generated Chrome Web Store assets in \(output.path)")
