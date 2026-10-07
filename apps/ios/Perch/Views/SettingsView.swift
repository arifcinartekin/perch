import PerchKit
import SwiftUI

/// The account and the server. Theme, colours and the rest are edited in the
/// extension or the web reader for now and follow the account here.
struct SettingsView: View {
  @Environment(Session.self) private var session
  @Environment(Reader.self) private var reader
  @Environment(\.dismiss) private var dismiss
  @State private var confirmingSignOut = false

  var body: some View {
    NavigationStack {
      Form {
        Section("Account") {
          LabeledContent("Username", value: session.user?.username ?? "—")
          if let server = session.server {
            LabeledContent("Server", value: server.host() ?? server.absoluteString)
          }
          Button("Sign out", role: .destructive) { confirmingSignOut = true }
        }

        Section {
          LabeledContent("Theme", value: themeName)
          LabeledContent(
            "Reading font", value: reader.settings.readingFont == .serif ? "Serif" : "Sans")
        } header: {
          Text("Appearance")
        } footer: {
          Text("Synced from your account. Change them in the Perch extension or web reader.")
        }

        Section {
          HStack {
            Spacer()
            VStack(spacing: 8) {
              Image("PerchMark").resizable().scaledToFit().frame(width: 44)
              Text("Perch \(version)").font(.footnote).foregroundStyle(.secondary)
            }
            Spacer()
          }
          .listRowBackground(Color.clear)
        }
      }
      .navigationTitle("Settings")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done", systemImage: "checkmark") { dismiss() }
        }
      }
      .confirmationDialog(
        "Sign out of \(session.server?.host() ?? "this server")?", isPresented: $confirmingSignOut,
        titleVisibility: .visible
      ) {
        Button("Sign out", role: .destructive) {
          Task {
            await session.signOut()
            dismiss()
          }
        }
      }
    }
  }

  private var themeName: String {
    switch reader.settings.theme {
    case .light: "Light"
    case .dark: "Dark"
    default: "System"
    }
  }

  private var version: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
  }
}
