import SwiftUI

/// The recovery code as a one-page PDF to keep or print, drawn like the app
/// and in its language. Matches the page the web reader makes
/// (packages/core/src/recovery-pdf.ts).
enum RecoveryPDF {
  static let size = CGSize(width: 595.28, height: 841.89)  // A4

  /// Writes it to a temporary file to hand to the share sheet.
  @MainActor
  static func write(code: String, username: String, host: String) -> URL? {
    let url = FileManager.default.temporaryDirectory
      .appending(path: "perch-recovery-\(username).pdf")
    let renderer = ImageRenderer(content: Page(code: code, username: username, host: host))
    renderer.proposedSize = ProposedViewSize(size)
    var ok = false
    renderer.render { size, draw in
      var box = CGRect(origin: .zero, size: size)
      guard let pdf = CGContext(url as CFURL, mediaBox: &box, nil) else { return }
      pdf.beginPDFPage(nil)
      draw(pdf)
      pdf.endPDFPage()
      pdf.closePDF()
      ok = true
    }
    return ok ? url : nil
  }

  private struct Page: View {
    let code: String
    let username: String
    let host: String

    private let ink = Color(red: 0x12 / 255, green: 0x15 / 255, blue: 0x1c / 255)
    private let muted = Color(red: 0x5b / 255, green: 0x60 / 255, blue: 0x70 / 255)
    private let faint = Color(red: 0x8a / 255, green: 0x8f / 255, blue: 0x9c / 255)
    private let accent = Color(red: 1, green: 0x7a / 255, blue: 0x1a / 255)
    private let cream = Color(red: 0xf7 / 255, green: 0xf5 / 255, blue: 0xf0 / 255)
    private let line = Color(red: 0xe2 / 255, green: 0xde / 255, blue: 0xd6 / 255)

    var body: some View {
      VStack(alignment: .leading, spacing: 0) {
        PerchLogoDrawing(colors: LogoColors(dark: false, text: ink, accent: accent))
          .frame(height: 46)
          .padding(.bottom, 64)

        Text("Recovery code")
          .font(.system(size: 26, weight: .bold))
          .foregroundStyle(ink)
        Text("For @\(username) on \(host)")
          .font(.system(size: 13))
          .foregroundStyle(muted)
          .padding(.top, 6)

        Text(verbatim: code)
          .font(.system(size: 26, weight: .bold, design: .monospaced))
          .foregroundStyle(ink)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 24)
          .background(cream, in: .rect(cornerRadius: 14))
          .overlay(RoundedRectangle(cornerRadius: 14).stroke(line, lineWidth: 1))
          .padding(.top, 24)
        Text("Made on \(Date.now.formatted(date: .long, time: .omitted))")
          .font(.system(size: 10))
          .foregroundStyle(faint)
          .padding(.top, 8)

        section("Keep it safe") {
          Text(
            "If you forget your password, this code is the only way back into your account. The server keeps only a scrambled copy, so nobody can tell it to you again. Store it somewhere private: a password manager, or printed and put away. Anyone with this code and your username can set a new password for your account."
          )
        }
        section("To use it") {
          Text(
            "1. Open Perch, choose Sign in, then \"Forgot your password?\".\n2. Enter your username, this code and a new password.\n3. Your other devices are signed out. You can make a new code in Settings, which replaces this one."
          )
        }

        Spacer(minLength: 0)
        Divider().overlay(line)
        HStack {
          Text(verbatim: "perch.ws")
          Spacer()
          Text("Keep this page private.")
        }
        .font(.system(size: 9.5))
        .foregroundStyle(faint)
        .padding(.top, 10)
      }
      .padding(.horizontal, 64)
      .padding(.top, 56)
      .padding(.bottom, 56)
      .frame(width: RecoveryPDF.size.width, height: RecoveryPDF.size.height, alignment: .topLeading)
      .background(.white)
      .environment(\.colorScheme, .light)
    }

    private func section(_ title: LocalizedStringKey, @ViewBuilder body: () -> Text) -> some View {
      VStack(alignment: .leading, spacing: 8) {
        Text(title)
          .font(.system(size: 13, weight: .bold))
          .foregroundStyle(ink)
        body()
          .font(.system(size: 11.5))
          .lineSpacing(4)
          .foregroundStyle(muted)
          .fixedSize(horizontal: false, vertical: true)
      }
      .padding(.top, 36)
    }
  }
}
