import PerchKit
import SwiftUI

/// Subscribe to a feed by its address, or a site's: the server finds the feed.
struct AddFeedSheet: View {
  @Environment(Reader.self) private var reader
  @Environment(\.dismiss) private var dismiss
  let onAdded: (Feed) -> Void

  @State private var url = ""
  @State private var categoryId = uncategorizedId
  @State private var busy = false
  @State private var error: String?
  @FocusState private var focused: Bool

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Site or feed address", text: $url)
            .keyboardType(.URL)
            .textContentType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .focused($focused)
            .submitLabel(.done)
            .onSubmit(add)
        } footer: {
          Text("Paste a feed, or any page that links to one. Perch Server finds and fetches it.")
        }

        if reader.library.categories.count > 1 {
          Picker("Category", selection: $categoryId) {
            ForEach(reader.groups, id: \.category.id) { group in
              Text(group.category.name).tag(group.category.id)
            }
          }
        }

        if let error {
          Section {
            Label(error, systemImage: "exclamationmark.triangle.fill")
              .foregroundStyle(.red)
          }
        }
      }
      .navigationTitle("Add a feed")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", systemImage: "xmark") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          if busy {
            ProgressView()
          } else {
            Button("Add", systemImage: "checkmark", action: add)
              .disabled(url.trimmingCharacters(in: .whitespaces).isEmpty)
          }
        }
      }
      .onAppear { focused = true }
    }
    .presentationDetents([.medium, .large])
  }

  private func add() {
    let address = url.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !address.isEmpty, !busy else { return }
    busy = true
    error = nil
    Task {
      defer { busy = false }
      do {
        let feed = try await reader.addFeed(url: address, categoryId: categoryId)
        dismiss()
        onAdded(feed)
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}
