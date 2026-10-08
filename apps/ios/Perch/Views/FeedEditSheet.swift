import PerchKit
import SwiftUI

/// Rename a feed or move it to another (or a new) category.
struct FeedEditSheet: View {
  @Environment(Reader.self) private var reader
  @Environment(\.dismiss) private var dismiss
  let feed: Feed

  @State private var title: String
  @State private var categoryId: String
  @State private var newCategory = ""
  @State private var busy = false
  @State private var error: String?

  init(feed: Feed) {
    self.feed = feed
    _title = State(initialValue: feed.customTitle ?? "")
    _categoryId = State(initialValue: feed.categoryId)
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField(feed.title.isEmpty ? "Title" : feed.title, text: $title)
        } header: {
          Text("Title")
        } footer: {
          Text("Leave blank to use the feed's own title.")
        }

        Section("Category") {
          CategoryPicker(selection: $categoryId, newCategory: $newCategory)
        }

        Section {
          LabeledContent("Address") {
            Text(feed.url).lineLimit(2).textSelection(.enabled)
          }
          if let site = feed.siteUrl, let url = URL(string: site) {
            Link(destination: url) { Label("Open website", systemImage: "safari") }
          }
          if let error = feed.lastError {
            LabeledContent("Last refresh") {
              Text(error).foregroundStyle(.orange)
            }
          }
        }

        if let error {
          Section {
            Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
          }
        }
      }
      .navigationTitle("Edit feed")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", systemImage: "xmark") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          if busy {
            ProgressView()
          } else {
            Button("Save", systemImage: "checkmark", action: save)
          }
        }
      }
    }
  }

  private func save() {
    busy = true
    error = nil
    Task {
      defer { busy = false }
      do {
        let category = try await CategoryPicker.resolve(categoryId, newCategory, reader: reader)
        try await reader.updateFeed(feed, title: title, categoryId: category)
        dismiss()
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}

/// Picks a category, or "New category…" with a name field.
struct CategoryPicker: View {
  @Environment(Reader.self) private var reader
  @Binding var selection: String
  @Binding var newCategory: String

  static let newTag = "\u{0}new"

  var body: some View {
    Picker("Category", selection: $selection) {
      ForEach(reader.categoryChoices) { c in
        Text(c.name).tag(c.id)
      }
      Text("New category…").tag(Self.newTag)
    }
    if selection == Self.newTag {
      TextField("New category name", text: $newCategory)
    }
  }

  /// The chosen category's id, creating the new one first if needed.
  static func resolve(_ selection: String, _ newName: String, reader: Reader) async throws
    -> String
  {
    guard selection == newTag else { return selection }
    let name = newName.trimmingCharacters(in: .whitespaces)
    guard !name.isEmpty else { return uncategorizedId }
    return try await reader.addCategory(name).id
  }
}
