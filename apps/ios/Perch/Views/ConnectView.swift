import PerchKit
import SwiftUI

/// Connect to a Perch Server, then sign in or create an account. The password
/// is stretched on the device; only the derived auth key is sent.
struct ConnectView: View {
  @Environment(Session.self) private var session

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
      VStack(spacing: 28) {
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
      }
      .padding(.horizontal, 20)
      .padding(.top, 64)
      .frame(maxWidth: 480)
      .frame(maxWidth: .infinity)
    }
    .scrollDismissesKeyboard(.interactively)
    .background { Backdrop() }
    .onAppear { focus = .address }
  }

  private var header: some View {
    VStack(spacing: 14) {
      Image("PerchLogo")
        .resizable()
        .scaledToFit()
        .frame(height: 52)
        .accessibilityLabel("Perch")
      Text("A calm, private reader for your feeds.")
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }
  }

  // MARK: Step 1: the server

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
      Text(
        verbatim:
          "The address of the server you or a friend runs. On the simulator, the Mac's own server is http://localhost:8080."
      )
      .font(.footnote)
      .foregroundStyle(.secondary)
      primaryButton("Continue", action: connect)
        .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty)
    }
  }

  private func connect() {
    guard let url = APIClient.normalizeServerURL(address) else {
      error = "That doesn't look like a server address."
      return
    }
    run {
      let info = try await APIClient(baseURL: url).serverInfo()
      guard info.software == "perch-server" else {
        throw APIError(status: 0, code: "not-perch", message: "That server isn't a Perch Server.")
      }
      guard info.mode == .personal else {
        throw APIError(
          status: 0, code: "e2e",
          message:
            "This server uses end-to-end encryption, which the iPhone app doesn't support yet.")
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
            .foregroundStyle(.secondary)
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
          .foregroundStyle(.secondary)
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
      error = "Use at least 8 characters for your password."
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

  private func primaryButton(_ title: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      ZStack {
        Text(title).opacity(busy ? 0 : 1)
        if busy { ProgressView().tint(Brand.ink) }
      }
      .font(.body.weight(.semibold))
      .foregroundStyle(Brand.ink)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 6)
    }
    .buttonStyle(.glassProminent)
    .tint(Brand.ember)
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
