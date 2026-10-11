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

/// Explore: the starter packs, any time. Add a whole pack into its own
/// category, or single feeds; what you already follow is marked.
struct StarterPacksView: View {
  @Environment(Reader.self) private var reader
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  @State private var busy: String?
  @State private var error: String?

  private var following: Set<String> {
    Set(reader.library.feeds.flatMap { [$0.id, FeedIDs.feed($0.url)] })
  }

  private func has(_ url: String) -> Bool { following.contains(FeedIDs.feed(url)) }

  var body: some View {
    NavigationStack {
      List {
        Section {
          Text(
            "A few well-known feeds per topic, picked by hand and listed in Perch's source. Add a whole pack into its own category, or just the feeds you want."
          )
          .font(.subheadline)
          .foregroundStyle(theme.muted)
          .listRowBackground(Color.clear)
        }
        ForEach(StarterPack.all) { pack in
          let left = pack.feeds.filter { !has($0.url) }.map(\.url)
          Section {
            ForEach(pack.feeds, id: \.url) { feed in
              HStack {
                VStack(alignment: .leading, spacing: 2) {
                  Text(feed.title)
                  Text(verbatim: URL(string: feed.url)?.host() ?? feed.url)
                    .font(.caption)
                    .foregroundStyle(theme.faint)
                }
                Spacer()
                if has(feed.url) {
                  Image(systemName: "checkmark")
                    .foregroundStyle(theme.muted)
                    .accessibilityLabel("Added")
                } else if busy == feed.url {
                  ProgressView()
                } else {
                  Button("Add") { add([feed.url], to: pack, key: feed.url) }
                    .buttonStyle(.glass)
                    .disabled(busy != nil)
                }
              }
              .surfaceRow()
            }
          } header: {
            HStack(alignment: .firstTextBaseline) {
              VStack(alignment: .leading, spacing: 2) {
                Text(pack.localTitle).font(.headline).textCase(nil)
                Text(pack.localDescription).font(.caption).textCase(nil)
                  .foregroundStyle(theme.muted)
              }
              Spacer()
              if busy == pack.id {
                ProgressView()
              } else if !left.isEmpty {
                Button(left.count == pack.feeds.count ? "Add all" : "Add the rest") {
                  add(left, to: pack, key: pack.id)
                }
                .font(.subheadline.weight(.medium))
                .textCase(nil)
                .disabled(busy != nil)
              }
            }
          }
        }
        if let error {
          Section {
            Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
          }
        }
      }
      .perchBackdrop()
      .navigationTitle("Explore")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done", systemImage: "checkmark") { dismiss() }
        }
      }
    }
  }

  private func add(_ urls: [String], to pack: StarterPack, key: String) {
    busy = key
    error = nil
    Task {
      defer { busy = nil }
      do {
        let added = try await reader.addFeeds(urls, category: pack.localTitle)
        if added < urls.count {
          error = String(localized: "Some feeds couldn't be reached. Try again later.")
        }
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}
