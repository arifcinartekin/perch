import SwiftUI

// The Perch logo drawn in the theme's colours, so it follows a custom accent
// like PerchMark / PerchLogo in packages/reader (same geometry, from
// brand/src). Compiled into the app and the widgets.

/// The logo's four colours. The bird takes the text colour, the beak and
/// waves the accent; the eye and the perch switch per scheme as in the brand
/// files (--logo-eye, --logo-perch in packages/reader/src/styles.css).
struct LogoColors {
  var body: Color
  var accent: Color
  var eye: Color
  var perch: Color

  init(dark: Bool, text: Color, accent: Color) {
    body = text
    self.accent = accent
    eye =
      dark
      ? Color(red: 0x12 / 255, green: 0x15 / 255, blue: 0x1c / 255)
      : Color(red: 0xf4 / 255, green: 0xf1 / 255, blue: 0xea / 255)
    perch = dark ? accent : text
  }
}

/// The bird on its perch. Below 28 points it switches to the simplified
/// drawing, which keeps the wave and the perch legible
/// (brand/src/perch-mark-small.svg).
struct PerchMarkDrawing: View {
  let colors: LogoColors

  var body: some View {
    GeometryReader { geo in
      let small = geo.size.width < 28
      Canvas { context, size in
        // viewBox 39 53 440 440.
        context.scaleBy(x: size.width / 440, y: size.height / 440)
        context.translateBy(x: -39, y: -53)
        if small {
          LogoPaths.smallBird(context, colors)
        } else {
          LogoPaths.bird(context, colors)
        }
      }
    }
    .aspectRatio(1, contentMode: .fit)
  }
}

/// The bird with the "perch" wordmark beside it, cropped to the drawing.
struct PerchLogoDrawing: View {
  let colors: LogoColors

  var body: some View {
    Canvas { context, size in
      // viewBox 88 106 1548 473.
      context.scaleBy(x: size.width / 1548, y: size.height / 473)
      context.translateBy(x: -88, y: -106)
      var bird = context
      bird.translateBy(x: 40, y: 30)
      LogoPaths.bird(bird, colors)
      var word = context
      word.translateBy(x: 660, y: 292)
      word.stroke(
        LogoPaths.wordmark, with: .color(colors.body),
        style: StrokeStyle(lineWidth: 38, lineCap: .round, lineJoin: .round))
    }
    .aspectRatio(1548 / 473, contentMode: .fit)
  }
}

private enum LogoPaths {
  static let body: Path = {
    var p = Path()
    p.move(to: CGPoint(x: 392, y: 176))
    p.addCurve(
      to: CGPoint(x: 304, y: 84), control1: CGPoint(x: 392, y: 120),
      control2: CGPoint(x: 352, y: 84))
    p.addCurve(
      to: CGPoint(x: 208, y: 164), control1: CGPoint(x: 252, y: 84),
      control2: CGPoint(x: 214, y: 118))
    p.addCurve(
      to: CGPoint(x: 56, y: 330), control1: CGPoint(x: 150, y: 188),
      control2: CGPoint(x: 96, y: 250))
    p.addLine(to: CGPoint(x: 172, y: 336))
    p.addCurve(
      to: CGPoint(x: 284, y: 416), control1: CGPoint(x: 188, y: 388),
      control2: CGPoint(x: 232, y: 416))
    p.addCurve(
      to: CGPoint(x: 404, y: 296), control1: CGPoint(x: 350, y: 416),
      control2: CGPoint(x: 400, y: 366))
    p.addCurve(
      to: CGPoint(x: 380, y: 222), control1: CGPoint(x: 406, y: 262),
      control2: CGPoint(x: 394, y: 236))
    p.addCurve(
      to: CGPoint(x: 392, y: 176), control1: CGPoint(x: 388, y: 210),
      control2: CGPoint(x: 392, y: 194))
    p.closeSubpath()
    return p
  }()

  static func polygon(_ points: [CGPoint]) -> Path {
    var p = Path()
    p.addLines(points)
    p.closeSubpath()
    return p
  }

  static func circle(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat) -> Path {
    Path(ellipseIn: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r))
  }

  /// Quarter circles from straight up round to the right, about (214, 330),
  /// like the SVG's "M 214 330-r A r r 0 0 1 214+r 330". Each starts with its
  /// own move, so no line joins one to the next.
  static func wave(_ radii: CGFloat...) -> Path {
    var p = Path()
    for r in radii {
      p.move(to: CGPoint(x: 214, y: 330 - r))
      p.addArc(
        tangent1End: CGPoint(x: 214 + r, y: 330 - r), tangent2End: CGPoint(x: 214 + r, y: 330),
        radius: r)
    }
    return p
  }

  static func bird(_ context: GraphicsContext, _ c: LogoColors) {
    context.fill(
      polygon([CGPoint(x: 362, y: 132), CGPoint(x: 462, y: 168), CGPoint(x: 372, y: 192)]),
      with: .color(c.accent))
    context.fill(body, with: .color(c.body))
    let waves = wave(64, 114)
    context.stroke(
      waves, with: .color(c.accent), style: StrokeStyle(lineWidth: 15, lineCap: .round))
    context.fill(circle(214, 330, 14), with: .color(c.accent))
    context.fill(circle(338, 150, 10), with: .color(c.eye))
    var legs = Path()
    legs.move(to: CGPoint(x: 262, y: 410))
    legs.addLine(to: CGPoint(x: 262, y: 440))
    legs.move(to: CGPoint(x: 312, y: 410))
    legs.addLine(to: CGPoint(x: 312, y: 440))
    context.stroke(legs, with: .color(c.body), style: StrokeStyle(lineWidth: 10, lineCap: .round))
    context.fill(
      Path(roundedRect: CGRect(x: 96, y: 436, width: 340, height: 26), cornerRadius: 13),
      with: .color(c.perch))
  }

  static func smallBird(_ context: GraphicsContext, _ c: LogoColors) {
    context.fill(
      polygon([CGPoint(x: 356, y: 128), CGPoint(x: 470, y: 168), CGPoint(x: 366, y: 198)]),
      with: .color(c.accent))
    context.fill(body, with: .color(c.body))
    context.stroke(
      wave(102), with: .color(c.accent), style: StrokeStyle(lineWidth: 34, lineCap: .round))
    context.fill(circle(220, 324, 26), with: .color(c.accent))
    context.fill(circle(336, 150, 20), with: .color(c.eye))
    context.fill(
      Path(roundedRect: CGRect(x: 90, y: 428, width: 352, height: 42), cornerRadius: 21),
      with: .color(c.perch))
  }

  /// "perch", in the wordmark's own space (translate(660 292) in the SVG).
  static let wordmark: Path = {
    var p = Path()
    func arc(_ cx: CGFloat, _ cy: CGFloat, _ start: Double, _ delta: Double) {
      p.addRelativeArc(
        center: CGPoint(x: cx, y: cy), radius: 80, startAngle: .degrees(start),
        delta: .degrees(delta))
    }
    // p
    p.move(to: CGPoint(x: 0, y: 20))
    p.addLine(to: CGPoint(x: 0, y: 260))
    p.addEllipse(in: CGRect(x: 0, y: 20, width: 160, height: 160))
    // e: the bar, then round the long way, ending 40° below it.
    p.move(to: CGPoint(x: 226, y: 100))
    p.addLine(to: CGPoint(x: 386, y: 100))
    arc(306, 100, 0, -320)
    // r
    p.move(to: CGPoint(x: 452, y: 20))
    p.addLine(to: CGPoint(x: 452, y: 180))
    p.move(to: CGPoint(x: 452, y: 100))
    arc(532, 100, 180, 90)
    // c: open 40° either side of the right.
    p.move(to: CGPoint(x: 723.3, y: 48.6))
    arc(662, 100, -40, -280)
    // h
    p.move(to: CGPoint(x: 789, y: -60))
    p.addLine(to: CGPoint(x: 789, y: 180))
    p.move(to: CGPoint(x: 789, y: 100))
    arc(869, 100, 180, 180)
    p.addLine(to: CGPoint(x: 949, y: 180))
    return p
  }()
}
