import AppKit

// Render one IPA demo preview using the layout of examples/og/research.png.
let usage = """
Usage: swift render_og.swift --output FILE.png --title TEXT --subtitle TEXT [--accent '#RRGGBB']

Creates a 1200 × 630 PNG. The output must not already exist.
Requires macOS and Swift with AppKit; no third-party dependencies.
"""

func fail(_ message: String) -> Never {
    fputs("render_og: \(message)\n", stderr)
    exit(1)
}

let arguments = Array(CommandLine.arguments.dropFirst())
if arguments == ["--help"] || arguments == ["-h"] {
    print(usage)
    exit(0)
}
let flags: Set<String> = ["--output", "--title", "--subtitle", "--accent"]
guard arguments.count.isMultiple(of: 2) else { fail(usage) }
var values: [String: String] = [:]
for index in stride(from: 0, to: arguments.count, by: 2) {
    let flag = arguments[index]
    guard flags.contains(flag), values[flag] == nil else {
        fail("Unknown or repeated option: \(flag)\n\(usage)")
    }
    values[flag] = arguments[index + 1]
}
func required(_ flag: String) -> String {
    guard let value = values[flag], !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        fail("Missing \(flag).\n\(usage)")
    }
    return value
}
let output = URL(fileURLWithPath: required("--output"))
let title = required("--title")
let subtitle = required("--subtitle")
guard output.pathExtension.lowercased() == "png" else { fail("--output must end in .png.") }
guard !FileManager.default.fileExists(atPath: output.path) else {
    fail("Output already exists. Render to a new path and review it before replacing an asset.")
}
guard title.rangeOfCharacter(from: .newlines) == nil else { fail("--title must be one line.") }

let accentValue = values["--accent"] ?? "#5CC7D1"
let hex = accentValue.hasPrefix("#") ? String(accentValue.dropFirst()) : accentValue
guard hex.count == 6, hex.allSatisfy({ $0.isHexDigit }), let rgb = UInt32(hex, radix: 16) else {
    fail("--accent must be a six-digit hex color such as #5CC7D1.")
}
let accent = NSColor(
    calibratedRed: CGFloat((rgb >> 16) & 255) / 255,
    green: CGFloat((rgb >> 8) & 255) / 255,
    blue: CGFloat(rgb & 255) / 255,
    alpha: 1
)

func rect(_ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat) -> NSRect {
    NSRect(x: x, y: y, width: width, height: height)
}
func drawText(_ text: String, _ x: CGFloat, _ y: CGFloat, _ font: NSFont, _ color: NSColor) {
    (text as NSString).draw(at: NSPoint(x: x, y: y), withAttributes: [
        .font: font, .foregroundColor: color,
    ])
}

var titleSize: CGFloat = 64
while titleSize > 44 && (title as NSString).size(withAttributes: [
    .font: NSFont.systemFont(ofSize: titleSize, weight: .bold),
]).width > 610 {
    titleSize -= 1
}
let titleFont = NSFont.systemFont(ofSize: titleSize, weight: .bold)
guard (title as NSString).size(withAttributes: [.font: titleFont]).width <= 610 else {
    fail("Shorten --title; it will not fit beside the illustration.")
}
let paragraph = NSMutableParagraphStyle()
paragraph.lineSpacing = 8
paragraph.lineBreakMode = .byWordWrapping
let subtitleAttributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 27, weight: .regular),
    .foregroundColor: NSColor(calibratedWhite: 0.82, alpha: 1),
    .paragraphStyle: paragraph,
]
let subtitleBounds = (subtitle as NSString).boundingRect(
    with: NSSize(width: 610, height: CGFloat.greatestFiniteMagnitude),
    options: [.usesLineFragmentOrigin, .usesFontLeading],
    attributes: subtitleAttributes
)
guard ceil(subtitleBounds.height) <= 104 else {
    fail("Shorten --subtitle; it exceeds the available text area.")
}

// Use a bitmap context so Retina display settings cannot change the pixel size.
guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: 1200, pixelsHigh: 630,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fail("Could not create the image canvas.")
}
bitmap.size = NSSize(width: 1200, height: 630)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.cgContext.setShouldAntialias(true)

NSColor(calibratedRed: 0.035, green: 0.095, blue: 0.083, alpha: 1).setFill()
rect(0, 0, 1200, 630).fill()
NSColor(calibratedRed: 0.07, green: 0.22, blue: 0.18, alpha: 1).setFill()
NSBezierPath(ovalIn: rect(745, 170, 560, 560)).fill()
accent.withAlphaComponent(0.13).setFill()
NSBezierPath(ovalIn: rect(850, 285, 380, 380)).fill()

// Card illustration.
NSColor(calibratedRed: 0.08, green: 0.15, blue: 0.135, alpha: 1).setFill()
let panel = NSBezierPath(roundedRect: rect(760, 146, 330, 338), xRadius: 24, yRadius: 24)
panel.fill()
NSColor.white.withAlphaComponent(0.11).setStroke()
panel.lineWidth = 2
panel.stroke()
accent.withAlphaComponent(0.85).setFill()
NSBezierPath(roundedRect: rect(792, 438, 106, 10), xRadius: 5, yRadius: 5).fill()
for index in 0..<3 {
    NSColor.white.withAlphaComponent(index == 0 ? 0.74 : 0.28).setFill()
    let line = rect(792, 386 - CGFloat(index) * 42, 238 - CGFloat(index % 2) * 58, 12)
    NSBezierPath(roundedRect: line, xRadius: 6, yRadius: 6).fill()
}
for index in 0..<3 {
    accent.withAlphaComponent(index == 0 ? 0.95 : 0.32).setFill()
    let chip = rect(792 + CGFloat(index) * 74, 210, 58, 34)
    NSBezierPath(roundedRect: chip, xRadius: 12, yRadius: 12).fill()
}

drawText("INFERENCE PROVIDER API", 84, 534,
         NSFont.monospacedSystemFont(ofSize: 18, weight: .semibold), accent)
drawText(title, 80, 398, titleFont, .white)
(subtitle as NSString).draw(in: rect(84, 255, 610, 104), withAttributes: subtitleAttributes)
drawText("DEMO APP", 84, 77, NSFont.monospacedSystemFont(ofSize: 16, weight: .medium),
         NSColor.white.withAlphaComponent(0.53))
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fail("Could not encode the PNG.")
}
do {
    try png.write(to: output, options: .withoutOverwriting)
    print(output.path)
} catch {
    fail("Could not save the PNG: \(error.localizedDescription)")
}
