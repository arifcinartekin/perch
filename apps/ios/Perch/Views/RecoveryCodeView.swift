import SwiftUI

/// A recovery code, shown once after it's made: the server keeps only its
/// hash. Done stays off until the person says they've saved it.
struct RecoveryCodeView: View {
  @Environment(\.theme) private var theme
  let code: String
  let username: String
  let host: String
  var doneTitle: LocalizedStringKey = "Continue"
  let onDone: () -> Void

  @State private var saved = false
  @State private var copied = false
  @State private var pdf: URL?

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text(
        "This is your recovery code. If you forget your password, it's the only way back into your account. Keep it somewhere safe, like a password manager. It won't be shown again."
      )
      .font(.footnote)
      .foregroundStyle(theme.muted)

      Text(verbatim: code)
        .font(.system(.title3, design: .monospaced).weight(.semibold))
        .textSelection(.enabled)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(.background.secondary, in: .rect(cornerRadius: 14))

      HStack {
        Button(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc") {
          UIPasteboard.general.string = code
          copied = true
        }
        Spacer()
        if let pdf {
          ShareLink(item: pdf) {
            Label("Save as PDF…", systemImage: "square.and.arrow.down")
          }
        }
      }
      .font(.subheadline.weight(.medium))

      Toggle("I've saved my recovery code", isOn: $saved)
        .font(.subheadline)

      Button(action: onDone) {
        Text(doneTitle)
          .font(.body.weight(.semibold))
          .foregroundStyle(theme.buttonContrast)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 6)
      }
      .buttonStyle(.glassProminent)
      .tint(theme.button)
      .disabled(!saved)
    }
    .task { pdf = RecoveryPDF.write(code: code, username: username, host: host) }
  }
}
