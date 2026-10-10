import PerchKit
import SwiftUI
import UniformTypeIdentifiers

/// The Settings tab. Reading and appearance follow the library (with a
/// server, the same settings as the extension and web reader); offline
/// reading and the wallpaper stay on this phone. Without a server, Sync
/// offers to connect to one; with one, account, devices and invites talk to
/// it.
struct SettingsView: View {
  @Environment(Session.self) private var session
  @Environment(Reader.self) private var reader
  @Environment(\.theme) private var theme
  @State private var confirmingSignOut = false
  @State private var connecting = false
  @State private var changingPassword = false
  @State private var changingEmail = false
  @State private var deletingAccount = false
  /// The signed-in server's /server answer: its own policy links (whoever
  /// runs it is responsible for it) and whether it takes recovery codes.
  @State private var serverInfo: ServerInfo?
  @State private var makingRecoveryCode = false
  @State private var importing = false
  @State private var exported: ExportedFile?
  @State private var exporting = false
  @State private var message: String?
  @State private var path = NavigationPath()

  enum Page: String, Hashable { case appearance, offline, devices, invites, chain }

  var body: some View {
    NavigationStack(path: $path) {
      Form {
        Section {
          HStack(spacing: 14) {
            PerchMark().frame(width: 44)
            VStack(alignment: .leading, spacing: 2) {
              if reader.isLocal {
                Text("Perch").font(.headline)
                Text("\(reader.library.feeds.count) feeds on this iPhone")
                  .font(.footnote).foregroundStyle(theme.muted)
              } else {
                Text(session.user?.displayName ?? session.username ?? "—").font(.headline)
                Text(serverLine).font(.footnote).foregroundStyle(theme.muted)
              }
            }
          }
          .surfaceRow()
        }

        Section("Reading") {
          Picker("Reading font", selection: readingFont) {
            Text("Sans").tag(SyncedSettings.ReadingFont.sans)
            Text("Serif").tag(SyncedSettings.ReadingFont.serif)
          }
          .surfaceRow()
          Toggle("Pictures in article lists", isOn: listImages)
            .surfaceRow()
          NavigationLink(value: Page.appearance) {
            Label("Appearance", systemImage: "paintpalette")
          }
          .surfaceRow()
          NavigationLink(value: Page.offline) {
            LabeledContent {
              Text(reader.isLocal ? "Always" : reader.device.offlineEnabled ? "On" : "Off")
            } label: {
              Label("Offline reading", systemImage: "arrow.down.circle")
            }
          }
          .surfaceRow()
        }

        Section {
          Toggle(isOn: notifications) {
            Label("New articles", systemImage: "bell.badge")
          }
          .surfaceRow()
        } header: {
          Text("Notifications")
        } footer: {
          Text(
            "A notification when background refresh finds new articles. iOS decides how often that runs, usually every hour or so."
          )
        }

        if reader.isLocal {
          Section {
            NavigationLink(value: Page.chain) {
              LabeledContent {
                Text(session.chain.isOn ? "On" : "Off")
              } label: {
                Label("Sync chain", systemImage: "link")
              }
            }
            .surfaceRow()
            Button("Connect to a Perch Server…", systemImage: "arrow.triangle.2.circlepath") {
              connecting = true
            }
            .surfaceRow()
          } header: {
            Text("Sync")
          } footer: {
            Text(
              "Your library is on this iPhone, and Perch fetches the feeds itself. A sync chain keeps it in step with your other devices without an account; a Perch Server also lets you read on the web."
            )
          }
        } else {
          Section {
            LabeledContent {
              Text(reader.isOffline ? "Offline" : "Connected")
                .foregroundStyle(reader.isOffline ? .orange : theme.muted)
            } label: {
              Label("Sync", systemImage: "arrow.triangle.2.circlepath")
            }
            .surfaceRow()
          } header: {
            Text("Sync")
          } footer: {
            Text(
              "Everything syncs through your Perch Server: feeds, read and starred articles, theme and colours. Changes made offline are sent when you're back."
            )
          }
          account
        }

        Section {
          Button("Export subscriptions", systemImage: "square.and.arrow.up") { export() }
            .disabled(exporting)
            .surfaceRow()
          Button("Import subscriptions…", systemImage: "square.and.arrow.down") {
            importing = true
          }
          .surfaceRow()
        } header: {
          Text("Import & export")
        } footer: {
          Text("OPML, the format every feed reader understands.")
        }

        if let host = session.server?.host() {
          Section {
            if let url = serverInfo?.legal?.privacy.flatMap(URL.init(string:)) {
              Link(destination: url) { Label("Privacy policy", systemImage: "hand.raised") }
                .surfaceRow()
            }
            if let url = serverInfo?.legal?.terms.flatMap(URL.init(string:)) {
              Link(destination: url) { Label("Terms of use", systemImage: "doc.text") }
                .surfaceRow()
            }
          } header: {
            Text(verbatim: host)
          } footer: {
            if serverInfo?.legal == nil {
              Text(
                "\(host) is run by its operator, who is responsible for your data there. It hasn't published a privacy policy."
              )
            } else {
              Text("\(host) is run by its operator, who is responsible for your data there.")
            }
          }
        }

        Section {
          Link(destination: URL(string: "https://perch.ws/privacy")!) {
            Label("App privacy", systemImage: "hand.raised")
          }
          .surfaceRow()
        } footer: {
          Text("The app collects nothing. Your library stays on this iPhone unless you sync it.")
        }

        Section {
          Text("Perch \(version)")
            .font(.footnote)
            .foregroundStyle(theme.muted)
            .frame(maxWidth: .infinity)
            .listRowBackground(Color.clear)
        }
      }
      .perchBackdrop()
      .navigationTitle("Settings")
      .navigationDestination(for: Page.self) { page in
        switch page {
        case .appearance: AppearanceSettingsView()
        case .offline: OfflineSettingsView()
        case .devices: DevicesView()
        case .invites: InvitesView()
        case .chain: ChainSettingsView()
        }
      }
      #if DEBUG
        .onAppear {
          // Simulator screenshots: PERCH_DEV_PAGE=appearance|offline|devices|invites.
          if path.isEmpty,
            let page = ProcessInfo.processInfo.environment["PERCH_DEV_PAGE"].flatMap(Page.init)
          {
            path.append(page)
          }
        }
      #endif
      .sheet(isPresented: $changingPassword) { ChangePasswordView() }
      .sheet(isPresented: $changingEmail) { EmailView() }
      .sheet(isPresented: $deletingAccount) { DeleteAccountView() }
      .task(id: session.server) {
        serverInfo = nil
        guard let server = session.server else { return }
        serverInfo = try? await APIClient(baseURL: server).serverInfo()
      }
      .sheet(isPresented: $makingRecoveryCode) { RecoveryCodeSettingsView() }
      .sheet(isPresented: $connecting) {
        NavigationStack { ConnectView(localFeeds: reader.library.feeds.count) }
      }
      .sheet(item: $exported) { file in ShareSheet(items: [file.url]) }
      .fileImporter(
        isPresented: $importing,
        allowedContentTypes: [UTType(filenameExtension: "opml") ?? .xml, .xml, .plainText]
      ) { result in
        if case .success(let url) = result { importOPML(url) }
      }
      .alert("Perch", isPresented: present($message)) {
        Button("OK") {}
      } message: {
        Text(message ?? "")
      }
      .confirmationDialog(
        "Sign out of \(session.server?.host() ?? "this server")?",
        isPresented: $confirmingSignOut, titleVisibility: .visible
      ) {
        Button("Sign out", role: .destructive) {
          Task { await session.signOut() }
        }
      } message: {
        Text(
          "Articles saved on this iPhone for offline reading are removed, and Perch goes back to the library on this iPhone."
        )
      }
    }
  }

  private var account: some View {
    Section("Account") {
      Button { changingEmail = true } label: {
        LabeledContent {
          Text(session.user?.hasEmail == true ? String(localized: "Added") : String(localized: "Add"))
        } label: {
          Label("Email", systemImage: "envelope")
        }
      }
      .surfaceRow()
      Button("Change password…", systemImage: "key") { changingPassword = true }
        .surfaceRow()
      if serverInfo?.recovery == true {
        Button { makingRecoveryCode = true } label: {
          LabeledContent {
            Text(session.user?.hasRecovery == true ? String(localized: "Set") : String(localized: "None"))
          } label: {
            Label("Recovery code", systemImage: "lifepreserver")
          }
        }
        .surfaceRow()
      }
      NavigationLink(value: Page.devices) {
        Label("Devices", systemImage: "iphone.gen3")
      }
      .surfaceRow()
      if session.user?.role == "admin" {
        NavigationLink(value: Page.invites) {
          Label("Invites", systemImage: "envelope.open")
        }
        .surfaceRow()
      }
      Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
        confirmingSignOut = true
      }
      .surfaceRow()
      Button("Delete account…", systemImage: "trash", role: .destructive) {
        deletingAccount = true
      }
      .surfaceRow()
    }
  }

  private var serverLine: String {
    let host = session.server?.host() ?? ""
    return session.user?.role == "admin" ? String(localized: "Admin of \(host)") : host
  }

  private var readingFont: Binding<SyncedSettings.ReadingFont> {
    Binding(
      get: { reader.settings.readingFont ?? .sans },
      set: { font in Task { await reader.updateSettings(SyncedSettings(readingFont: font)) } })
  }

  private var notifications: Binding<Bool> {
    Binding(
      get: { reader.device.notifyNewArticles },
      set: { on in
        guard on else {
          reader.device.notifyNewArticles = false
          return
        }
        Task {
          if await Glance.requestPermission() {
            reader.device.notifyNewArticles = true
          } else {
            message = String(
              localized:
                "Notifications are off for Perch. Turn them on in the Settings app, under Notifications."
            )
          }
        }
      })
  }

  private var listImages: Binding<Bool> {
    Binding(get: { reader.device.listImages }, set: { reader.device.listImages = $0 })
  }

  private var version: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
  }

  private func export() {
    exporting = true
    Task {
      defer { exporting = false }
      do {
        let data = try await reader.backend.exportOPML()
        let url = URL.temporaryDirectory.appending(path: "perch-subscriptions.opml")
        try data.write(to: url, options: .atomic)
        exported = ExportedFile(url: url)
      } catch {
        message = String(localized: "Couldn't export: \(error.localizedDescription)")
      }
    }
  }

  private func importOPML(_ url: URL) {
    Task {
      let access = url.startAccessingSecurityScopedResource()
      defer { if access { url.stopAccessingSecurityScopedResource() } }
      do {
        let data = try Data(contentsOf: url)
        let result = try await reader.backend.importOPML(data)
        await reader.load()
        // On the phone, the new feeds are fetched now.
        if reader.isLocal { Task { await reader.refresh() } }
        message =
          result.existing > 0
          ? String(
            localized:
              "Added \(result.added) feeds, \(result.existing) were already here. New feeds are fetched in the background."
          )
          : String(
            localized: "Added \(result.added) feeds. New feeds are fetched in the background.")
      } catch {
        message = String(localized: "Couldn't import: \(error.localizedDescription)")
      }
    }
  }
}

struct ExportedFile: Identifiable {
  let url: URL
  var id: URL { url }
}

struct ShareSheet: UIViewControllerRepresentable {
  let items: [Any]
  func makeUIViewController(context: Context) -> UIActivityViewController {
    UIActivityViewController(activityItems: items, applicationActivities: nil)
  }
  func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

// MARK: - Account

struct ChangePasswordView: View {
  @Environment(Session.self) private var session
  @Environment(Reader.self) private var reader
  @Environment(\.dismiss) private var dismiss
  @State private var current = ""
  @State private var new = ""
  @State private var confirm = ""
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    NavigationStack {
      Form {
        Section {
          SecureField("Current password", text: $current).textContentType(.password)
        }
        Section {
          SecureField("New password", text: $new).textContentType(.newPassword)
          SecureField("Repeat new password", text: $confirm).textContentType(.newPassword)
        } footer: {
          Text(
            "At least 8 characters. Your other devices are signed out and need the new password.")
        }
        if let error {
          Section {
            Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
          }
        }
      }
      .navigationTitle("Change password")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", systemImage: "xmark") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          if busy {
            ProgressView()
          } else {
            Button("Change", systemImage: "checkmark", action: save)
              .disabled(current.isEmpty || new.isEmpty)
          }
        }
      }
    }
  }

  private func save() {
    guard new.count >= 8 else {
      error = String(localized: "Use at least 8 characters.")
      return
    }
    guard new == confirm else {
      error = String(localized: "The new passwords don't match.")
      return
    }
    guard let username = session.user?.username ?? session.username else { return }
    busy = true
    error = nil
    Task {
      defer { busy = false }
      do {
        try await reader.server?.changePassword(username: username, current: current, new: new)
        dismiss()
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}

/// Makes a new recovery code (the old one stops working) after the password,
/// and shows it once.
struct RecoveryCodeSettingsView: View {
  @Environment(Session.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var password = ""
  @State private var code: String?
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    NavigationStack {
      Form {
        if let code {
          Section {
            RecoveryCodeView(code: code, host: session.server?.host() ?? "", doneTitle: "Done") {
              dismiss()
            }
          }
        } else {
          Section {
            SecureField("Password", text: $password).textContentType(.password)
          } footer: {
            if session.user?.hasRecovery == true {
              Text("Making a new recovery code replaces the old one, which stops working.")
            } else {
              Text("Without a recovery code, a forgotten password means a lost account.")
            }
          }
          if let error {
            Section {
              Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
            }
          }
        }
      }
      .navigationTitle("Recovery code")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        if code == nil {
          ToolbarItem(placement: .cancellationAction) {
            Button("Cancel", systemImage: "xmark") { dismiss() }
          }
          ToolbarItem(placement: .confirmationAction) {
            if busy {
              ProgressView()
            } else {
              Button("Make code", action: make).disabled(password.isEmpty)
            }
          }
        }
      }
      .interactiveDismissDisabled(code != nil)
    }
  }

  private func make() {
    busy = true
    error = nil
    Task {
      defer { busy = false }
      do {
        code = try await session.newRecoveryCode(password: password)
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}

/// Deletes the account on the server after the password; the library on the
/// phone comes back, as after signing out.
struct DeleteAccountView: View {
  @Environment(Session.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var password = ""
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    NavigationStack {
      Form {
        Section {
          SecureField("Password", text: $password).textContentType(.password)
        } footer: {
          Text(
            "This removes your account on \(session.server?.host() ?? "this server") with your feeds, read state, settings, notes and shared pages. It can't be undone."
          )
        }
        if let error {
          Section {
            Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
          }
        }
      }
      .navigationTitle("Delete account")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", systemImage: "xmark") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          if busy {
            ProgressView()
          } else {
            Button("Delete", role: .destructive, action: remove)
              .tint(.red)
              .disabled(password.isEmpty)
          }
        }
      }
    }
  }

  private func remove() {
    busy = true
    error = nil
    Task {
      defer { busy = false }
      do {
        try await session.deleteAccount(password: password)
        dismiss()
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}

/// Add or change the account's email address: the server mails a code, and
/// the address is saved once the code is entered. It's used for password reset.
struct EmailView: View {
  @Environment(Session.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var email = ""
  @State private var code = ""
  /// Where the code went; nil until one is sent.
  @State private var sentTo: String?
  @State private var busy = false
  @State private var error: String?
  @FocusState private var focus: Field?
  private enum Field { case email, code }

  var body: some View {
    NavigationStack {
      Form {
        if let sentTo {
          Section {
            TextField("Code", text: $code)
              .textContentType(.oneTimeCode)
              .keyboardType(.numberPad)
              .focused($focus, equals: .code)
          } footer: {
            Text("We sent a 6-digit code to \(sentTo). It works for 10 minutes.")
          }
          Section {
            Button("Use a different address or send a new code") {
              self.sentTo = nil
              code = ""
              error = nil
              focus = .email
            }
          }
        } else {
          Section {
            TextField("Email", text: $email)
              .textContentType(.emailAddress)
              .keyboardType(.emailAddress)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
              .focused($focus, equals: .email)
              .submitLabel(.send)
              .onSubmit(send)
          } header: {
            if session.user?.hasEmail == true {
              Text("An address is added")
            }
          } footer: {
            Text(
              "Used only to reset your password. The server keeps a hash of it, not the address. We'll email you a code to confirm it."
            )
          }
        }
        if let error {
          Section {
            Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
          }
        }
      }
      .navigationTitle(session.user?.hasEmail == true ? "Change email" : "Add email")
      .navigationBarTitleDisplayMode(.inline)
      .onAppear { focus = .email }
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", systemImage: "xmark") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          if busy {
            ProgressView()
          } else if sentTo != nil {
            Button("Confirm", systemImage: "checkmark", action: confirm)
              .disabled(code.filter(\.isNumber).count != 6)
          } else {
            Button("Send code", systemImage: "paperplane", action: send)
              .disabled(email.trimmingCharacters(in: .whitespaces).isEmpty)
          }
        }
      }
    }
  }

  private func send() {
    let address = email.trimmingCharacters(in: .whitespaces)
    guard !address.isEmpty else { return }
    run {
      try await session.requestEmailChange(address)
      sentTo = address
      focus = .code
    }
  }

  private func confirm() {
    guard let sentTo else { return }
    run {
      try await session.confirmEmail(sentTo, code: code.filter(\.isNumber))
      dismiss()
    }
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

struct DevicesView: View {
  @Environment(Reader.self) private var reader
  @Environment(\.theme) private var theme
  @State private var devices: [Device]?
  @State private var error: String?

  var body: some View {
    List {
      if let devices {
        Section {
          ForEach(devices) { device in
            VStack(alignment: .leading, spacing: 2) {
              Text(device.current ? "\(device.name) (this iPhone)" : device.name)
              Text(
                "Signed in \(Self.date(device.createdAt)) · last seen \(Self.date(device.lastSeenAt))"
              )
              .font(.footnote)
              .foregroundStyle(theme.muted)
            }
            .surfaceRow()
            .swipeActions {
              if !device.current {
                Button("Sign out", role: .destructive) { revoke(device) }
              }
            }
          }
        } footer: {
          Text("Every browser and phone signed in to your account. Swipe to sign one out.")
        }
      }
    }
    .perchBackdrop()
    .overlay {
      if devices == nil {
        if let error {
          ContentUnavailableView(
            "Couldn't load devices", systemImage: "wifi.exclamationmark",
            description: Text(error))
        } else {
          ProgressView()
        }
      }
    }
    .navigationTitle("Devices")
    .task { await load() }
    .refreshable { await load() }
  }

  private func load() async {
    do {
      devices = try await reader.server?.devices() ?? []
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func revoke(_ device: Device) {
    devices?.removeAll { $0.id == device.id }
    Task {
      try? await reader.server?.revokeDevice(device.id)
      await load()
    }
  }

  static func date(_ ms: Double) -> String {
    Date(timeIntervalSince1970: ms / 1000).formatted(.relative(presentation: .named))
  }
}

struct InvitesView: View {
  @Environment(Reader.self) private var reader
  @Environment(\.theme) private var theme
  @State private var invites: [Invite]?
  @State private var error: String?
  @State private var creating = false

  var body: some View {
    List {
      Section {
        Button("Create an invite", systemImage: "plus") { create() }
          .disabled(creating)
          .surfaceRow()
      } footer: {
        Text("Each code lets one person create an account on your server.")
      }
      if let invites {
        let open = invites.filter { $0.usedBy == nil }
        let used = invites.filter { $0.usedBy != nil }
        if !open.isEmpty {
          Section("Unused") {
            ForEach(open) { invite in
              HStack {
                Text(invite.code).font(.body.monospaced()).textSelection(.enabled)
                Spacer()
                ShareLink(item: invite.code) { Image(systemName: "square.and.arrow.up") }
                  .buttonStyle(.borderless)
              }
              .surfaceRow()
              .swipeActions {
                Button("Delete", role: .destructive) { delete(invite) }
              }
            }
          }
        }
        if !used.isEmpty {
          Section("Used") {
            ForEach(used) { invite in
              LabeledContent(invite.code) {
                Text(invite.usedBy ?? "")
              }
              .font(.body.monospaced())
              .surfaceRow()
            }
          }
        }
      }
    }
    .perchBackdrop()
    .overlay {
      if invites == nil, let error {
        ContentUnavailableView(
          "Couldn't load invites", systemImage: "wifi.exclamationmark", description: Text(error))
      }
    }
    .navigationTitle("Invites")
    .task { await load() }
  }

  private func load() async {
    do {
      invites = try await reader.server?.invites() ?? []
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func create() {
    creating = true
    Task {
      defer { creating = false }
      _ = try? await reader.server?.createInvite()
      await load()
    }
  }

  private func delete(_ invite: Invite) {
    invites?.removeAll { $0.code == invite.code }
    Task {
      try? await reader.server?.deleteInvite(invite.code)
      await load()
    }
  }
}
