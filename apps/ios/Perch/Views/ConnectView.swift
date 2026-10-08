import PerchKit
import SwiftUI

/// Connect to a Perch Server, then sign in or create an account, from
/// Settings: the app works without one, and a server adds sync with the
/// other clients. The password is stretched on the device; only the derived
/// auth key is sent.
struct ConnectView: View {
  @Environment(Session.self) private var session
  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss
  /// How many feeds the phone's library has; they're added to the account.
  var localFeeds = 0

  @State private var address =
    UserDefaults.standard.url(forKey: "perch.server")?.absoluteString ?? ""
  @State private var server: (url: URL, info: ServerInfo)?
  @State private var creating = false
  @State private var username = ""
  @State private var password = ""
  @State private var invite = ""
  @State private var busy = false
  @State private var error: String?

  @FocusState private var focus: Field?
  private enum Field { case address, username, password, invite }

  var body: some View {
    ScrollView {
      VStack(spacing: 30) {
        header
        VStack(alignment: .leading, spacing: 16) {
          if let server {
            accountForm(server.url, server.info)
          } else {
            serverForm
          }
          if let error {
            Label(error, systemImage: "exclamationmark.triangle.fill")
              .font(.footnote)
              .foregroundStyle(.red)
              .transition(.opacity)
          }
        }
        .padding(22)
        .glassEffect(.regular, in: .rect(cornerRadius: 28))
        .animation(.snappy, value: server?.url)
        .animation(.snappy, value: error)

        if server == nil {
          features
            .transition(.opacity)
        }
      }
      .padding(.horizontal, 20)
      .padding(.top, 8)
      .padding(.bottom, 24)
      .frame(maxWidth: 480)
      .frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    .scrollBounceBehavior(.basedOnSize)
    .foregroundStyle(theme.text)
    .background { Backdrop() }
    .toolbar {
      ToolbarItem(placement: .cancellationAction) {
        Button("Cancel", systemImage: "xmark") { dismiss() }
      }
    }
  }

  private var header: some View {
    VStack(spacing: 16) {
      PerchLogo()
        .frame(height: 48)
        .background {
          Circle()
            .fill(theme.accent.opacity(0.28))
            .frame(width: 160, height: 160)
            .blur(radius: 60)
        }
      Text("Sync with a Perch Server")
        .font(.title2.weight(.semibold))
        .multilineTextAlignment(.center)
      Text(
        "Perch works on its own. With a server you or a friend runs, your feeds and what you've read follow you to the browser extension and the web."
      )
      .font(.subheadline)
      .multilineTextAlignment(.center)
      .foregroundStyle(theme.muted)
    }
  }

  /// What Perch is, under the server form on first launch.
  private var features: some View {
    VStack(alignment: .leading, spacing: 16) {
      feature(
        "lock.shield", "Yours",
        "Feeds and reading history live on your own server, not someone else's.")
      feature(
        "arrow.triangle.2.circlepath", "In sync",
        "Read here, in the browser extension or on the web; it's all the same library.")
      feature(
        "arrow.down.circle", "Offline",
        "Recent and starred articles stay on your iPhone, pictures included.")
    }
    .padding(.horizontal, 8)
  }

  private func feature(_ symbol: String, _ title: LocalizedStringKey, _ text: LocalizedStringKey)
    -> some View
  {
    HStack(alignment: .top, spacing: 14) {
      Image(systemName: symbol)
        .font(.title3)
        .foregroundStyle(theme.accent)
        .frame(width: 28)
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.subheadline.weight(.semibold))
        Text(text).font(.subheadline).foregroundStyle(theme.muted)
      }
    }
    .accessibilityElement(children: .combine)
  }

  // MARK: Step 1: the server

  private static let localServer = "http://localhost:8080"

  private var serverForm: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("Your Perch Server")
        .font(.headline)
      TextField("perch.example.com", text: $address)
        .textContentType(.URL)
        .keyboardType(.URL)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .focused($focus, equals: .address)
        .submitLabel(.continue)
        .onSubmit(connect)
        .fieldStyle()
      Group {
        #if targetEnvironment(simulator)
          Text(
            "The address of the Perch Server you or a friend runs. On the simulator, the Mac's own server is \(Self.localServer)."
          )
        #else
          Text("The address of the Perch Server you or a friend runs.")
        #endif
        if localFeeds > 0 {
          Text("The \(localFeeds) feeds on this iPhone are added to the account.")
        }
      }
      .font(.footnote)
      .foregroundStyle(theme.muted)
      primaryButton("Continue", action: connect)
        .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty)
    }
  }

  private func connect() {
    guard let url = APIClient.normalizeServerURL(address) else {
      error = String(localized: "That doesn't look like a server address.")
      return
    }
    run {
      let info = try await APIClient(baseURL: url).serverInfo()
      guard info.software == "perch-server" else {
        throw APIError(
          status: 0, code: "not-perch",
          message: String(localized: "That server isn't a Perch Server."))
      }
      guard info.mode == .personal else {
        throw APIError(
          status: 0, code: "e2e",
          message: String(
            localized:
              "This server uses end-to-end encryption, which the iPhone app doesn't support yet."))
      }
      server = (url, info)
      creating = info.needsSetup
      focus = .username
    }
  }

  // MARK: Step 2: the account

  @ViewBuilder
  private func accountForm(_ url: URL, _ info: ServerInfo) -> some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        VStack(alignment: .leading, spacing: 2) {
          Text(info.needsSetup ? "Set up your server" : creating ? "Create an account" : "Sign in")
            .font(.headline)
          Text(url.host() ?? url.absoluteString)
            .font(.footnote)
            .foregroundStyle(theme.muted)
        }
        Spacer()
        Button("Change") {
          server = nil
          error = nil
          focus = .address
        }
        .font(.footnote.weight(.medium))
      }

      if info.needsSetup {
        Text("No accounts yet. The first one you create here is the admin.")
          .font(.footnote)
          .foregroundStyle(theme.muted)
      }

      TextField("Username", text: $username)
        .textContentType(.username)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .focused($focus, equals: .username)
        .submitLabel(.next)
        .onSubmit { focus = .password }
        .fieldStyle()
      SecureField("Password", text: $password)
        .textContentType(creating ? .newPassword : .password)
        .focused($focus, equals: .password)
        .submitLabel(creating && needsInvite(info) ? .next : .go)
        .onSubmit {
          if creating && needsInvite(info) { focus = .invite } else { submit(url) }
        }
        .fieldStyle()
      if creating && needsInvite(info) {
        TextField("Invite code", text: $invite)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .focused($focus, equals: .invite)
          .submitLabel(.go)
          .onSubmit { submit(url) }
          .fieldStyle()
      }

      primaryButton(creating ? "Create account" : "Sign in") { submit(url) }
        .disabled(username.isEmpty || password.isEmpty)

      if !info.needsSetup && info.signup != .closed {
        Button(creating ? "I already have an account" : "Create an account") {
          creating.toggle()
          error = nil
        }
        .font(.footnote.weight(.medium))
        .frame(maxWidth: .infinity)
      }
    }
  }

  private func needsInvite(_ info: ServerInfo) -> Bool {
    !info.needsSetup && info.signup == .invite
  }

  private func submit(_ url: URL) {
    guard !username.isEmpty, !password.isEmpty else { return }
    if creating && password.count < 8 {
      error = String(localized: "Use at least 8 characters for your password.")
      return
    }
    run {
      if creating {
        try await session.register(
          server: url, username: username, password: password, invite: invite)
      } else {
        try await session.signIn(server: url, username: username, password: password)
      }
    }
  }

  // MARK: -

  private func primaryButton(_ title: LocalizedStringKey, action: @escaping () -> Void) -> some View
  {
    Button(action: action) {
      ZStack {
        Text(title).opacity(busy ? 0 : 1)
        if busy { ProgressView().tint(theme.buttonContrast) }
      }
      .font(.body.weight(.semibold))
      .foregroundStyle(theme.buttonContrast)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 6)
    }
    .buttonStyle(.glassProminent)
    .tint(theme.button)
    .disabled(busy)
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

extension View {
  /// A text field on the glass card.
  func fieldStyle() -> some View {
    padding(.horizontal, 14)
      .padding(.vertical, 12)
      .background(.background.opacity(0.55), in: .rect(cornerRadius: 14))
      .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.primary.opacity(0.08)))
  }
}
