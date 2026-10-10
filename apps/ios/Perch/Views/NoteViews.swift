import PerchKit
import SwiftUI

// Notes: the editor sheet, the list under the Feeds tab, and the markdown
// rendering both use. Notes are markdown; the phone shows the inline part
// (bold, italic, code, links) and keeps line breaks.

enum NoteMarkdown {
  static func attributed(_ markdown: String) -> AttributedString {
    (try? AttributedString(
      markdown: markdown,
      options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
      ?? AttributedString(markdown)
  }

  /// The note as HTML for the article page: escaped text, inline styles, and
  /// links only to http(s).
  static func html(_ markdown: String) -> String {
    let text = attributed(markdown)
    var out = ""
    for run in text.runs {
      var piece = ArticleHTML.escape(String(text[run.range].characters))
        .replacingOccurrences(of: "\n", with: "<br>")
      let intent = run.inlinePresentationIntent ?? []
      if intent.contains(.code) { piece = "<code>\(piece)</code>" }
      if intent.contains(.stronglyEmphasized) { piece = "<strong>\(piece)</strong>" }
      if intent.contains(.emphasized) { piece = "<em>\(piece)</em>" }
      if intent.contains(.strikethrough) { piece = "<s>\(piece)</s>" }
      if let link = run.link, link.scheme == "http" || link.scheme == "https" {
        piece = "<a href=\"\(ArticleHTML.escape(link.absoluteString))\">\(piece)</a>"
      }
      out += piece
    }
    return out
  }
}

/// Write or edit the note on an article, and share it.
struct NoteEditorView: View {
  @Environment(Reader.self) private var reader
  @Environment(\.dismiss) private var dismiss
  let source: NoteSource

  @State private var draft = ""
  @State private var preview = false
  @State private var busy = false
  @State private var error: String?
  @State private var copied = false
  @FocusState private var focused: Bool

  private var note: Note? { reader.notes.first { $0.id == source.id } }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("Mode", selection: $preview) {
            Text("Write").tag(false)
            Text("Preview").tag(true)
          }
          .pickerStyle(.segmented)
          .listRowBackground(Color.clear)
          .listRowInsets(EdgeInsets())
        }
        Section {
          if preview {
            Text(draft.isEmpty ? AttributedString(String(localized: "Nothing written yet.")) : NoteMarkdown.attributed(draft))
              .frame(maxWidth: .infinity, minHeight: 160, alignment: .topLeading)
              .foregroundStyle(draft.isEmpty ? .secondary : .primary)
          } else {
            TextEditor(text: $draft)
              .frame(minHeight: 220)
              .focused($focused)
              .onChange(of: draft) { _, value in
                if value.count > Note.maxLength { draft = String(value.prefix(Note.maxLength)) }
              }
          }
        } header: {
          Text(source.title).lineLimit(2).textCase(nil)
        } footer: {
          HStack {
            Text(verbatim: String(localized: "Markdown works: **bold**, _italic_, [link](https://…)"))
            Spacer()
            Text("\(draft.count) / \(Note.maxLength)").monospacedDigit()
          }
        }

        if let note {
          shareSection(note)
          Section {
            Button("Delete note", role: .destructive) {
              run {
                try await reader.deleteNote(note.id)
                dismiss()
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
      .navigationTitle(note == nil ? "New note" : "Note")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", systemImage: "xmark") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          if busy {
            ProgressView()
          } else {
            Button("Done", systemImage: "checkmark") {
              run {
                try await save()
                dismiss()
              }
            }
          }
        }
      }
      .onAppear {
        draft = note?.body ?? ""
        focused = note == nil
      }
    }
  }

  @ViewBuilder
  private func shareSection(_ note: Note) -> some View {
    Section {
      if let shared = note.sharedUrl.flatMap(URL.init(string:)) {
        ShareLink(item: shared) { Label("Share link", systemImage: "square.and.arrow.up") }
        Button(copied ? "Copied" : "Copy link", systemImage: copied ? "checkmark" : "link") {
          UIPasteboard.general.url = shared
          copied = true
        }
        Button("Stop sharing", systemImage: "eye.slash", role: .destructive) {
          run { try await reader.unshareNote(note.id) }
        }
      } else if reader.sharingUnavailable == nil {
        Button("Share as a public page", systemImage: "link") {
          run {
            try await save()
            let url = try await reader.shareNote(note.id)
            UIPasteboard.general.string = url
            copied = true
          }
        }
        .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    } header: {
      Text("Sharing")
    } footer: {
      if note.sharedUrl != nil {
        Text("Anyone with the link can read this note. Edits show there too.")
      } else if let reason = reader.sharingUnavailable {
        Text(reason)
      } else {
        Text("Makes a page anyone with the link can read, and copies the link.")
      }
    }
  }

  private func save() async throws {
    guard draft != (note?.body ?? "") else { return }
    try await reader.saveNote(source, body: draft)
  }

  private func run(_ work: @escaping () async throws -> Void) {
    busy = true
    error = nil
    Task {
      defer { busy = false }
      do {
        try await work()
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}

/// Every note, newest first.
struct NotesListView: View {
  @Environment(Reader.self) private var reader
  @State private var editing: Note?

  var body: some View {
    List {
      if reader.notes.isEmpty {
        ContentUnavailableView(
          "No notes yet", systemImage: "note.text",
          description: Text(
            "Open an article and tap the note button to write down what you think. Notes stay private unless you share one."
          )
        )
        .listRowBackground(Color.clear)
      }
      ForEach(reader.notes) { note in
        Button { editing = note } label: { NoteRow(note: note) }
          .buttonStyle(.plain)
          .surfaceRow()
          .swipeActions {
            Button("Delete", systemImage: "trash", role: .destructive) {
              Task { try? await reader.deleteNote(note.id) }
            }
          }
      }
    }
    .perchBackdrop()
    .navigationTitle("Notes")
    .refreshable { await reader.loadNotes() }
    .sheet(item: $editing) { note in
      NoteEditorView(
        source: NoteSource(
          feedId: note.feedId, articleId: note.articleId, title: note.title, url: note.url,
          feedTitle: note.feedTitle))
    }
  }
}

private struct NoteRow: View {
  @Environment(\.theme) private var theme
  let note: Note

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) {
        if let feed = note.feedTitle { Text(feed).lineLimit(1) }
        Text(note.updated, style: .relative)
        if note.sharedUrl != nil {
          Image(systemName: "link").accessibilityLabel("Shared")
        }
      }
      .font(.caption)
      .foregroundStyle(theme.muted)
      Text(note.title.isEmpty ? String(localized: "Untitled") : note.title)
        .font(.headline)
        .lineLimit(2)
      Text(NoteMarkdown.attributed(note.body))
        .font(.subheadline)
        .lineLimit(4)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.vertical, 4)
    .contentShape(.rect)
  }
}
