#!/usr/bin/env swift
import AppKit
import Foundation

// Render the existing vector identity directly; iOS requires opaque app icons.
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let app = root.appendingPathComponent("apple/StayFast Video/Shared (App)")
let catalog = app.appendingPathComponent("Assets.xcassets/AppIcon.appiconset")
guard let mark = NSImage(contentsOf: root.appendingPathComponent("src/assets/icons/stayfast-mark.svg")) else {
    fatalError("Could not load StayFast vector mark")
}

func render(_ name: String, size: Int, opaque: Bool, destination: URL = catalog) throws {
    let alpha = opaque ? CGImageAlphaInfo.noneSkipLast : CGImageAlphaInfo.premultipliedLast
    guard let canvas = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                                 bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(),
                                 bitmapInfo: alpha.rawValue) else {
        fatalError("Could not create icon canvas")
    }
    let context = NSGraphicsContext(cgContext: canvas, flipped: false)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    let bounds = NSRect(x: 0, y: 0, width: size, height: size)
    if opaque {
        NSColor(red: 6 / 255, green: 27 / 255, blue: 45 / 255, alpha: 1).setFill()
        NSBezierPath(rect: bounds).fill()
    }
    context.imageInterpolation = .high
    let inset = opaque ? 0 : CGFloat(size) * 0.08
    mark.draw(in: bounds.insetBy(dx: inset, dy: inset), from: .zero, operation: .sourceOver, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    guard let image = canvas.makeImage(),
          let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
        fatalError("Could not encode icon")
    }
    try png.write(to: destination.appendingPathComponent(name), options: .atomic)
}

try render("universal-icon-1024@1x.png", size: 1024, opaque: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        try render("mac-icon-\(size)@\(scale)x.png", size: size * scale, opaque: false)
    }
}
try render("Icon.png", size: 256, opaque: false, destination: app.appendingPathComponent("Resources"))
try render("icon128.png", size: 128, opaque: false,
           destination: app.appendingPathComponent("Assets.xcassets/LargeIcon.imageset"))
