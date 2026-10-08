import PerchKit
import SwiftUI

/// Subscribe to a feed by its address, or a site's: the server finds the feed.
struct AddFeedSheet: View {
  @Environment(Reader.self) private var reader
  @Environment(\.dismiss) private var dismiss
  let onAdded: (Feed) -> Void

  @State private var url = ""
  @State private var categoryId = uncategorizedId
  @State private var newCategory = ""
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
          PasteButton(payloadType: URL.self) { urls in
            if let first = urls.first { url = first.absoluteString }
          }
          .labelStyle(.titleAndIcon)
        } footer: {
          Text(
            "Paste a feed, or any page that links to one. Your Perch Server finds and fetches it.")
        }

        Section("Category") {
          CategoryPicker(selection: $categoryId, newCategory: $newCategory)
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
        let category = try await CategoryPicker.resolve(categoryId, newCategory, reader: reader)
        let feed = try await reader.addFeed(url: address, categoryId: category)
        dismiss()
        onAdded(feed)
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}
