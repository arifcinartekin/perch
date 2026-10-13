import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Share → Perch from Safari or any app that shares a link: keeps the page's
/// address for the app, which finds its feed and asks where to put it the
/// next time it opens. The extension itself never goes online.
final class ShareViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    let host = UIHostingController(
      rootView: ShareView(
        load: { [weak self] in await self?.sharedURL() },
        done: { [weak self] in self?.extensionContext?.completeRequest(returningItems: nil) },
        cancel: { [weak self] in
          self?.extensionContext?.cancelRequest(
            withError: NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError))
        }))
    addChild(host)
    host.view.frame = view.bounds
    host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    host.view.backgroundColor = .clear
    view.addSubview(host.view)
    host.didMove(toParent: self)
  }

  /// The shared link, or the first address in shared text.
  private func sharedURL() async -> URL? {
    let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
      .flatMap { $0.attachments ?? [] }
    for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
      if let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL,
        url.scheme == "http" || url.scheme == "https"
      {
        return url
      }
    }
    for provider in providers
    where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
      if let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier)
        as? String,
        let match = text.firstMatch(of: /https?:\/\/\S+/),
        let url = URL(string: String(match.output))
      {
        return url
      }
    }
    return nil
  }
}

private struct ShareView: View {
  @Environment(\.colorScheme) private var colorScheme
  let load: () async -> URL?
  let done: () -> Void
  let cancel: () -> Void
  @State private var url: URL?
  @State private var loaded = false
  @State private var saved = false

  var body: some View {
    NavigationStack {
      VStack(spacing: 14) {
        PerchMarkDrawing(
          colors: LogoColors(
            dark: colorScheme == .dark, text: .primary, accent: Color(red: 1, green: 0.478, blue: 0.102)))
          .frame(width: 44)
        if let url {
          Text(url.host() ?? url.absoluteString)
            .font(.headline)
            .multilineTextAlignment(.center)
          Text(
            saved
              ? "Open Perch to finish: it finds this site's feed and asks where to put it."
              : "Perch finds this site's feed the next time you open it."
          )
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
        } else if loaded {
          Text("There's no web address in what you shared.")
            .foregroundStyle(.secondary)
        } else {
          ProgressView()
        }
      }
      .padding(24)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .navigationTitle("Add to Perch")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", systemImage: "xmark", action: cancel)
        }
        ToolbarItem(placement: .confirmationAction) {
          if saved {
            Button("Done", systemImage: "checkmark", action: done)
          } else {
            Button("Add", systemImage: "checkmark") {
              guard let url else { return }
              SharedInbox.put(url)
              saved = true
            }
            .disabled(url == nil)
          }
        }
      }
    }
    .task {
      url = await load()
      loaded = true
    }
  }
}
