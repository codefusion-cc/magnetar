import AppKit
import CoreGraphics

// Magnetar icon: the star everything falls into, on the night ground, inside the loops of its magnetic field. Renders the macOS iconset, the Windows tray icon sizes, the web icons (favicon, apple-touch, PWA and
// maskable) and monochrome menu-bar template images. The same shape lives as SVG in apps/web/public/icon.svg and
// apps/web/src/ui/BrandMark.tsx (there in the look's colours).
//
//   swift makeicon.swift <out dir>
//   iconutil -c icns <out dir>/AppIcon.iconset -o AppIcon.icns
//   magick <out dir>/tray/{16,20,24,32,40,48,64,256}.png TrayIcon.ico

let args = CommandLine.arguments
let outDir = args.count > 1 ? args[1] : "."

func makeContext(_ size: Int) -> CGContext {
    let cs = CGColorSpace(name: CGColorSpace.sRGB)!
    return CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                     bytesPerRow: 0, space: cs,
                     bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
}

func savePNG(_ ctx: CGContext, _ path: String) {
    let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}

func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
}

/// One loop of the star's field, r = L sin²θ around an axis leaning left and towards the viewer, turned `a` round it
/// (apps/web/src/ui/sky/draw.ts `fieldLoop`): its points around the centre, y down, and how near the viewer it lies.
func fieldLoop(_ L: CGFloat, _ a: CGFloat, steps: Int = 40) -> (points: [CGPoint], depth: CGFloat) {
    let axis = [sin(-0.42) * cos(0.5), -cos(-0.42) * cos(0.5), sin(0.5)]
    let normal = [axis[1], -axis[0], 0.0]
    let length = (normal[0] * normal[0] + normal[1] * normal[1]).squareRoot()
    let u = normal.map { $0 / length }
    let v = [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]]
    let d = (0..<3).map { u[$0] * cos(Double(a)) + v[$0] * sin(Double(a)) }
    let points = (0...steps).map { k -> CGPoint in
        let th = Double(k) / Double(steps) * .pi, r = Double(L) * pow(sin(th), 2), z = r * cos(th), q = r * sin(th)
        return CGPoint(x: axis[0] * z + d[0] * q, y: axis[1] * z + d[1] * q)
    }
    return (points, CGFloat(d[2]))
}

/// The star in a 100-unit square (y down, like the SVG), placed into `rect`: a glow, six loops of its field (nearer
/// ones brighter) and the star on top. Lines keep at least a pixel, so the loops stay loops at 16 px.
/// `template` draws it in black alone for the menu bar.
func drawGlyph(_ c: CGContext, in rect: CGRect, template: Bool = false) {
    let u = rect.width / 100
    let p = { (x: CGFloat, y: CGFloat) in CGPoint(x: rect.midX + x * u, y: rect.midY - y * u) }
    let center = p(0, 0)
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    if !template {
        let glow = CGGradient(colorsSpace: space, colors: [rgb(0xff7832, 0.55), rgb(0xff7832, 0)] as CFArray, locations: [0, 1])!
        c.drawRadialGradient(glow, startCenter: center, startRadius: 0, endCenter: center, endRadius: 35 * u, options: [])
    }
    c.setLineWidth(max((template ? 2.6 : 1.8) * u, 1))
    c.setLineCap(.round)
    c.setLineJoin(.round)
    for j in 0..<6 {
        let loop = fieldLoop(45, CGFloat(j) * .pi / 3 + 0.3)
        let near = 0.35 + 0.55 * (loop.depth + 1) / 2
        c.setStrokeColor(template ? rgb(0x000000, 0.45 + 0.55 * (loop.depth + 1) / 2) : rgb(0xffd08a, near))
        c.addLines(between: loop.points.map { p($0.x, $0.y) })
        c.strokePath()
    }
    let radius = (template ? 14 : 12) * u
    let disc = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
    if template {
        c.setFillColor(rgb(0x000000))
        c.fillEllipse(in: disc)
        return
    }
    let core = CGGradient(colorsSpace: space, colors: [rgb(0xffffff), rgb(0xfff3dc), rgb(0xffc27a)] as CFArray, locations: [0, 0.7, 1])!
    c.saveGState()
    c.addEllipse(in: disc)
    c.clip()
    let highlight = CGPoint(x: center.x - radius * 0.4, y: center.y + radius * 0.4)
    c.drawRadialGradient(core, startCenter: highlight, startRadius: 0, endCenter: center, endRadius: radius, options: [.drawsAfterEndLocation])
    c.restoreGState()
}

/// The night tile. `radius` is a fraction of the side; macOS icons keep a margin and a small shadow.
func drawTile(_ c: CGContext, _ rect: CGRect, radius: CGFloat, shadow: Bool) {
    let path = CGPath(roundedRect: rect, cornerWidth: rect.width * radius, cornerHeight: rect.width * radius, transform: nil)
    if shadow {
        c.saveGState()
        c.setShadow(offset: CGSize(width: 0, height: -rect.width * 0.01), blur: rect.width * 0.03, color: rgb(0x000000, 0.3))
        c.addPath(path)
        c.setFillColor(rgb(0x070505))
        c.fillPath()
        c.restoreGState()
    }
    c.saveGState()
    c.addPath(path)
    c.clip()
    let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                              colors: [rgb(0x1e1714), rgb(0x0d0908), rgb(0x070505)] as CFArray, locations: [0, 0.5, 1])!
    c.drawLinearGradient(gradient, start: CGPoint(x: rect.midX, y: rect.maxY), end: CGPoint(x: rect.midX, y: rect.minY), options: [])
    c.restoreGState()
}

/// App and web icons. `bleed` fills the whole canvas (apple-touch, maskable, Windows); otherwise
/// the tile keeps macOS's ~10% margin and casts a small shadow.
func drawIcon(_ size: Int, bleed: Bool = false, glyphScale: CGFloat = 1) -> CGContext {
    let c = makeContext(size)
    let side = CGFloat(size)
    let tile = bleed ? CGRect(x: 0, y: 0, width: side, height: side) : CGRect(x: 0, y: 0, width: side, height: side).insetBy(dx: side * 0.0742, dy: side * 0.0742)
    drawTile(c, tile, radius: bleed ? 0 : 0.225, shadow: !bleed && size >= 64)
    let glyph = tile.insetBy(dx: tile.width * (1 - glyphScale) / 2, dy: tile.height * (1 - glyphScale) / 2)
    drawGlyph(c, in: glyph)
    return c
}

/// Windows tray and taskbar: the tile edge to edge with rounded corners, no margin.
func drawTray(_ size: Int) -> CGContext {
    let c = makeContext(size)
    let rect = CGRect(x: 0, y: 0, width: CGFloat(size), height: CGFloat(size))
    drawTile(c, rect, radius: 0.225, shadow: false)
    drawGlyph(c, in: rect)
    return c
}

/// Menu-bar template image: the star alone in black, filling the small canvas.
func drawTemplate(_ size: Int) -> CGContext {
    let c = makeContext(size)
    drawGlyph(c, in: CGRect(x: 0, y: 0, width: CGFloat(size), height: CGFloat(size)), template: true)
    return c
}

let fm = FileManager.default
let iconset = "\(outDir)/AppIcon.iconset"
try? fm.createDirectory(atPath: iconset, withIntermediateDirectories: true)
for (name, size) in [("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64),
                     ("icon_128x128", 128), ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512),
                     ("icon_512x512", 512), ("icon_512x512@2x", 1024)] {
    savePNG(drawIcon(size), "\(iconset)/\(name).png")
}
let web = "\(outDir)/web"
try? fm.createDirectory(atPath: web, withIntermediateDirectories: true)
savePNG(drawIcon(256), "\(web)/favicon.png")
savePNG(drawIcon(180, bleed: true, glyphScale: 0.86), "\(web)/apple-touch-icon.png")
savePNG(drawIcon(192), "\(web)/icon-192.png")
savePNG(drawIcon(512), "\(web)/icon-512.png")
// Maskable: launchers crop to a circle or squircle, so the glyph stays inside the central 80%.
savePNG(drawIcon(512, bleed: true, glyphScale: 0.72), "\(web)/icon-maskable-512.png")
let tray = "\(outDir)/tray"
try? fm.createDirectory(atPath: tray, withIntermediateDirectories: true)
for size in [16, 20, 24, 32, 40, 48, 64, 256] {
    savePNG(drawTray(size), "\(tray)/\(size).png")
}
savePNG(drawTemplate(18), "\(outDir)/MenuBarIcon.png")
savePNG(drawTemplate(36), "\(outDir)/MenuBarIcon@2x.png")
print("done")
