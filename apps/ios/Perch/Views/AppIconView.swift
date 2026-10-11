import SwiftUI
import UIKit

/// Settings → App icon: the default and five other colourings of the same
/// drawing (scripts/brand.mjs). Stays on this phone; not synced.
struct AppIconView: View {
  @Environment(\.theme) private var theme
  @State private var current = UIApplication.shared.alternateIconName
  @State private var error: String?

  struct Choice: Identifiable {
    /// The alternate icon's name, or nil for the default.
    var icon: String?
    var name: LocalizedStringKey
    var preview: String
    var id: String { preview }
  }

  static let choices: [Choice] = [
    Choice(icon: nil, name: "Night", preview: "IconPreview-Default"),
    Choice(icon: "AppIcon-Black", name: "Black", preview: "IconPreview-Black"),
    Choice(icon: "AppIcon-White", name: "White", preview: "IconPreview-White"),
    Choice(icon: "AppIcon-Green", name: "Green", preview: "IconPreview-Green"),
    Choice(icon: "AppIcon-Blue", name: "Blue", preview: "IconPreview-Blue"),
    Choice(icon: "AppIcon-Midnight", name: "Midnight", preview: "IconPreview-Midnight"),
  ]

  static var currentPreview: String {
    choices.first { $0.icon == UIApplication.shared.alternateIconName }?.preview
      ?? "IconPreview-Default"
  }

  var body: some View {
    Form {
      Section {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 88), spacing: 16)], spacing: 20) {
          ForEach(Self.choices) { choice in
            Button {
              select(choice)
            } label: {
              VStack(spacing: 8) {
                Image(choice.preview)
                  .resizable()
                  .frame(width: 72, height: 72)
                  .clipShape(.rect(cornerRadius: 16, style: .continuous))
                  .overlay {
                    RoundedRectangle(cornerRadius: 19, style: .continuous)
                      .stroke(theme.accent, lineWidth: 3)
                      .padding(-4)
                      .opacity(choice.icon == current ? 1 : 0)
                  }
                Text(choice.name)
                  .font(.footnote)
                  .foregroundStyle(choice.icon == current ? theme.text : theme.muted)
              }
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(choice.icon == current ? .isSelected : [])
          }
        }
        .padding(.vertical, 12)
        .surfaceRow()
      } footer: {
        Text("Only on this iPhone; your other devices keep theirs.")
      }
      if let error {
        Section {
          Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
        }
      }
    }
    .perchBackdrop()
    .navigationTitle("App icon")
    .navigationBarTitleDisplayMode(.inline)
  }

  private func select(_ choice: Choice) {
    guard choice.icon != current, UIApplication.shared.supportsAlternateIcons else { return }
    Task {
      do {
        try await UIApplication.shared.setAlternateIconName(choice.icon)
        current = choice.icon
        error = nil
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}
