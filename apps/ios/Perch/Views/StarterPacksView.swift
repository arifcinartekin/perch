import PerchKit
import SwiftUI

/// A few well-known feeds per topic, for an empty library. The list ships in
/// the app (Support/starter-packs.json, generated from
/// packages/core/src/starter-packs.ts): picking one tells no server.
struct StarterPack: Decodable, Identifiable {
  struct Words: Decodable {
    var en: String
    var tr: String
  }
  struct Feed: Decodable {
    var title: String
    var url: String
    var lang: String
  }
  var id: String
  var title: Words
  var description: Words
  var lang: String
  var feeds: [Feed]

  static let turkish = Locale.current.language.languageCode?.identifier == "tr"

  var localTitle: String { Self.turkish ? title.tr : title.en }
  var localDescription: String { Self.turkish ? description.tr : description.en }

  /// The packs, the viewer's language first.
  static let all: [StarterPack] = {
    guard let url = Bundle.main.url(forResource: "starter-packs", withExtension: "json"),
      let data = try? Data(contentsOf: url),
      let packs = try? JSONDecoder().decode([StarterPack].self, from: data)
    else { return [] }
    let mine = turkish ? "tr" : "en"
    return packs.enumerated()
      .sorted { ($0.element.lang == mine ? 0 : 1, $0.offset) < ($1.element.lang == mine ? 0 : 1, $1.offset) }
      .map(\.element)
  }()
}

struct StarterPacksView: View {
  @Environment(Reader.self) private var reader
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  @State private var busy: String?
  @State private var added: Set<String> = []
  @State private var error: String?

  var body: some View {
    NavigationStack {
      List {
        Section {
          ForEach(StarterPack.all) { pack in
            HStack(alignment: .top, spacing: 12) {
              VStack(alignment: .leading, spacing: 4) {
                Text(pack.localTitle).font(.headline)
                Text(pack.localDescription)
                  .font(.subheadline)
                  .foregroundStyle(theme.muted)
                Text(pack.feeds.map(\.title).joined(separator: " · "))
                  .font(.caption)
                  .foregroundStyle(theme.faint)
              }
              Spacer()
              if busy == pack.id {
                ProgressView()
              } else if added.contains(pack.id) {
                Image(systemName: "checkmark.circle.fill")
                  .foregroundStyle(theme.accent)
                  .accessibilityLabel("Added")
              } else {
                Button("Add") { add(pack) }
                  .buttonStyle(.glass)
                  .disabled(busy != nil)
              }
            }
            .padding(.vertical, 4)
            .surfaceRow()
          }
        } footer: {
          Text(
            "Picked by hand and listed in Perch's source. Each pack goes into its own category; remove anything you don't want."
          )
        }
        if let error {
          Section {
            Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
          }
        }
      }
      .perchBackdrop()
      .navigationTitle("Starter packs")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done", systemImage: "checkmark") { dismiss() }
        }
      }
    }
  }

  private func add(_ pack: StarterPack) {
    busy = pack.id
    error = nil
    Task {
      defer { busy = nil }
      do {
        try await reader.addFeeds(pack.feeds.map(\.url), category: pack.localTitle)
        added.insert(pack.id)
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}
