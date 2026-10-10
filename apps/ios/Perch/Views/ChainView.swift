import CoreImage.CIFilterBuiltins
import PerchKit
import SwiftUI

/// Settings → Sync chain: sync the library on this phone with your other
/// devices without an account. Start a chain, join one with its code (or by
/// scanning its QR code with the Camera), add devices, leave.
struct ChainSettingsView: View {
  @Environment(Session.self) private var session
  @Environment(Reader.self) private var reader
  @Environment(\.theme) private var theme
  @State private var joining = false
  @State private var showingCode = false
  @State private var confirmingDelete = false
  @State private var busy = false
  @State private var message: String?

  private var chain: ChainLink { session.chain }
  private var local: LocalBackend? { reader.backend as? LocalBackend }

  var body: some View {
    Form {
      if let account = chain.account {
        inChain(account)
      } else {
        notInChain
      }
    }
    .perchBackdrop()
    .navigationTitle("Sync chain")
    .navigationBarTitleDisplayMode(.inline)
    .sheet(isPresented: $joining) {
      NavigationStack { JoinChainView() }
    }
    .alert("Perch", isPresented: present($message)) {
      Button("OK") {}
    } message: {
      Text(message ?? "")
    }
  }

  // MARK: Not in a chain

  @ViewBuilder private var notInChain: some View {
    Section {
      VStack(alignment: .leading, spacing: 10) {
        Image(systemName: "link.circle.fill")
          .font(.system(size: 40))
          .foregroundStyle(theme.accent)
        Text("Your library on every device, no account")
          .font(.headline)
        Text(
          "A sync chain keeps this iPhone, your browsers and your other devices in step: feeds, categories, read and starred articles, theme and colours. Everything is encrypted on your devices with the chain's code; the relay that passes it on can't read your feeds or what you read."
        )
        .font(.subheadline)
        .foregroundStyle(theme.muted)
      }
      .padding(.vertical, 6)
      .surfaceRow()
    }

    Section {
      Button {
        start()
      } label: {
        HStack {
          Label("Start a chain", systemImage: "plus.circle")
          Spacer()
          if busy { ProgressView() }
        }
      }
      .disabled(busy || local == nil)
      .surfaceRow()
      Button("Join a chain…", systemImage: "qrcode.viewfinder") { joining = true }
        .disabled(busy || local == nil)
        .surfaceRow()
    } footer: {
      Text(
        "Started in the browser extension? Choose Join, then scan its QR code or enter its code. Each device fetches the feeds itself."
      )
    }
  }

  private func start() {
    guard let local else { return }
    busy = true
    Task {
      defer { busy = false }
      do {
        try await chain.start(server: ChainCode.defaultServer, backend: local)
        showingCode = true
        await reader.syncChain()
      } catch {
        message = ChainLink.describe(error)
      }
    }
  }

  // MARK: In a chain

  @ViewBuilder private func inChain(_ account: ChainAccount) -> some View {
    if chain.lastError == .ended {
      Section {
        Label("This chain was deleted on another device.", systemImage: "link.badge.plus")
          .surfaceRow()
        Button("Leave chain") { Task { await leave() } }
          .surfaceRow()
      } footer: {
        Text("Your library stays on this iPhone.")
      }
    } else {
      Section {
        LabeledContent {
          status
        } label: {
          Label("Sync chain", systemImage: "link")
        }
        .surfaceRow()
        Button {
          Task { await reader.syncChain() }
        } label: {
          Label("Sync now", systemImage: "arrow.triangle.2.circlepath")
        }
        .disabled(chain.syncing)
        .surfaceRow()
      } footer: {
        Text("Encrypted, through \(account.server.host() ?? account.server.absoluteString).")
      }

      Section {
        DisclosureGroup(isExpanded: $showingCode) {
          ChainCodeCard(account: account)
            .padding(.vertical, 8)
        } label: {
          Label("Add a device", systemImage: "qrcode")
        }
        .surfaceRow()
      } footer: {
        Text(
          "Anyone with this code can read and change what the chain syncs. Only show it to your own devices."
        )
      }

      if !chain.devices.isEmpty {
        Section {
          ForEach(sortedDevices(account), id: \.id) { id, device in
            LabeledContent {
              if id == account.node {
                Text("This iPhone").foregroundStyle(theme.muted)
              } else if Date.now.timeIntervalSince1970 * 1000 - device.seenAt
                < ChainDevice.refresh * 2
              {
                Text("Active").foregroundStyle(theme.muted)
              } else {
                Text(
                  Date(timeIntervalSince1970: device.seenAt / 1000),
                  format: .relative(presentation: .named)
                )
                .foregroundStyle(theme.muted)
              }
            } label: {
              Label(device.name, systemImage: icon(device.platform))
            }
            .surfaceRow()
            .swipeActions {
              if id != account.node {
                Button("Forget", role: .destructive) {
                  Task { if let local { await chain.forget(id, local) } }
                }
              }
            }
          }
        } header: {
          Text("Devices")
        } footer: {
          Text(
            "Swipe to forget a device you no longer use. That only hides it: to cut a device off, delete the chain and start a new one."
          )
        }
      }

      Section {
        Button("Leave chain") { Task { await leave() } }
          .surfaceRow()
        Button("Delete chain…", role: .destructive) { confirmingDelete = true }
          .surfaceRow()
      } footer: {
        Text(
          "Leaving stops syncing on this iPhone. Deleting removes the chain from the relay and stops it on every device. Your library stays on each device either way."
        )
      }
      .confirmationDialog(
        "Delete this chain?", isPresented: $confirmingDelete, titleVisibility: .visible
      ) {
        Button("Delete chain", role: .destructive) { Task { await delete() } }
      } message: {
        Text("Every device in it stops syncing. Feeds, articles and settings stay on each one.")
      }
    }
  }

  @ViewBuilder private var status: some View {
    if chain.syncing {
      ProgressView()
    } else if let error = chain.lastError {
      Text(error == .unreachable ? "Offline" : "Error")
        .foregroundStyle(.orange)
    } else if let at = chain.lastSyncAt {
      Text(at, format: .relative(presentation: .named))
        .foregroundStyle(theme.muted)
    } else {
      Text("On").foregroundStyle(theme.muted)
    }
  }

  private func sortedDevices(_ account: ChainAccount) -> [(id: String, device: ChainDevice)] {
    chain.devices.map { (id: $0.key, device: $0.value) }.sorted {
      ($0.id == account.node ? 1 : 0, $0.device.seenAt) > ($1.id == account.node ? 1 : 0, $1.device.seenAt)
    }
  }

  private func icon(_ platform: String) -> String {
    switch platform {
    case "ios": "iphone"
    case "chrome", "firefox": "macwindow"
    default: "desktopcomputer"
    }
  }

  private func leave() async {
    guard let local else { return }
    await chain.leave(local)
  }

  private func delete() async {
    guard let local else { return }
    do {
      try await chain.delete(local)
    } catch {
      message = ChainLink.describe(error)
    }
  }
}

/// The chain's QR code and code, for adding a device.
struct ChainCodeCard: View {
  let account: ChainAccount
  @Environment(\.theme) private var theme
  @State private var copied = false

  var body: some View {
    VStack(spacing: 14) {
      QRCodeImage(text: ChainCode.link(server: account.server, code: account.code).absoluteString)
        .frame(width: 200, height: 200)
        .accessibilityLabel("QR code for joining the chain")
      Text(account.code)
        .font(.system(.callout, design: .monospaced).weight(.medium))
        .multilineTextAlignment(.center)
        .textSelection(.enabled)
      Button(copied ? "Copied" : "Copy code", systemImage: copied ? "checkmark" : "doc.on.doc") {
        UIPasteboard.general.string = account.code
        copied = true
      }
      .buttonStyle(.bordered)
      Text(
        "In the browser extension: Settings → Sync chain → Join, then enter the code. On another iPhone, scan the QR code with the Camera."
      )
      .font(.footnote)
      .foregroundStyle(theme.muted)
      .multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity)
  }
}

/// Black on white, with a quiet zone, so any camera reads it in either theme.
struct QRCodeImage: View {
  let text: String

  var body: some View {
    if let image = Self.render(text) {
      Image(decorative: image, scale: 1)
        .interpolation(.none)
        .resizable()
        .scaledToFit()
        .padding(10)
        .background(.white, in: .rect(cornerRadius: 14))
    }
  }

  static func render(_ text: String) -> CGImage? {
    let filter = CIFilter.qrCodeGenerator()
    filter.message = Data(text.utf8)
    filter.correctionLevel = "M"
    guard let output = filter.outputImage else { return nil }
    return CIContext().createCGImage(output, from: output.extent)
  }
}

/// Join a chain: type or paste its code, or arrive from a scanned QR code
/// (a perch://chain link) with it filled in.
struct JoinChainView: View {
  @Environment(Session.self) private var session
  @Environment(Reader.self) private var reader
  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss
  var server = ChainCode.defaultServer
  var code = ""

  @State private var typed = ""
  @State private var scanning = false
  @State private var relay = ""
  @State private var otherRelay = false
  @State private var busy = false
  @State private var error: String?
  @FocusState private var focused: Bool

  var body: some View {
    Form {
      if !reader.isLocal {
        Section {
          Text(
            "Sync chains are for the library on this iPhone. Sign out of your Perch Server in Settings to use one."
          )
          .surfaceRow()
        }
      } else if session.chain.isOn {
        Section {
          Text("This iPhone is already in a sync chain. Leave it in Settings → Sync chain first.")
            .surfaceRow()
        }
      } else {
        Section {
          Button("Scan QR code", systemImage: "qrcode.viewfinder") { scanning = true }
            .surfaceRow()
        } footer: {
          Text("Scan the QR code shown on the device that started the chain, or type its code below.")
        }

        Section {
          TextField("Chain code", text: $typed, prompt: Text(verbatim: "7GQ2-M4XD-…"))
            .font(.system(.body, design: .monospaced))
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled()
            .focused($focused)
            .submitLabel(.join)
            .onSubmit(join)
            .surfaceRow()
          if UIPasteboard.general.hasStrings {
            Button("Paste", systemImage: "doc.on.clipboard") {
              typed = UIPasteboard.general.string ?? ""
            }
            .surfaceRow()
          }
        } header: {
          Text("Code")
        } footer: {
          Text(
            "The 28-letter code shown where the chain was started. Your feeds here and the chain's are merged."
          )
        }

        Section {
          if otherRelay {
            TextField("Relay address", text: $relay)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
              .keyboardType(.URL)
              .surfaceRow()
          } else {
            Button("Use another relay") {
              relay = server.absoluteString
              otherRelay = true
            }
            .surfaceRow()
          }
        } footer: {
          Text("Relay: \(relayURL?.host() ?? "—")")
        }

        if let error {
          Section {
            Label(error, systemImage: "exclamationmark.triangle.fill")
              .foregroundStyle(.red)
              .font(.footnote)
              .surfaceRow()
          }
        }
      }
    }
    .perchBackdrop()
    .sheet(isPresented: $scanning) {
      ChainQRScanner { url in
        typed = url.absoluteString
        join()
      }
    }
    .navigationTitle("Join a chain")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .cancellationAction) {
        Button("Cancel", systemImage: "xmark") { dismiss() }
      }
      if reader.isLocal && !session.chain.isOn {
        ToolbarItem(placement: .confirmationAction) {
          if busy {
            ProgressView()
          } else {
            Button("Join", action: join)
              .disabled(typed.trimmingCharacters(in: .whitespaces).isEmpty)
          }
        }
      }
    }
    .onAppear {
      if typed.isEmpty { typed = code }
      if code.isEmpty { focused = true }
    }
  }

  private var relayURL: URL? {
    otherRelay ? APIClient.normalizeServerURL(relay) : server
  }

  private func join() {
    guard let local = reader.backend as? LocalBackend, !busy else { return }
    // A pasted link carries its relay along with the code.
    var code = typed
    var url = relayURL
    if let link = URL(string: typed.trimmingCharacters(in: .whitespaces)),
      let parsed = ChainCode.parseLink(link)
    {
      code = parsed.code
      url = parsed.server
    }
    guard let url else {
      error = String(localized: "That doesn't look like a server address.")
      return
    }
    busy = true
    error = nil
    Task {
      defer { busy = false }
      do {
        try await session.chain.join(server: url, code: code, backend: local)
        await reader.syncChain()
        dismiss()
      } catch {
        self.error = ChainLink.describe(error)
      }
    }
  }
}
