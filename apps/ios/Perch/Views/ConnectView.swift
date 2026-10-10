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
  /// `.library`: the library moves to the server and syncs there.
  /// `.community`: the Perch account, for sharing; the library stays put.
  var purpose: Session.Account = .library

  @State private var address = ""
  @State private var addressLoaded = false
  @State private var server: (url: URL, info: ServerInfo)?
  @State private var creating = false
  @State private var username = ""
  @State private var password = ""
  @State private var invite = ""
  /// Setting a new password with an emailed code.
  @State private var resetting = false
  /// Setting a new password with the recovery code.
  @State private var recovering = false
  @State private var recoveryInput = ""
  /// A new account, held back while its recovery code is shown.
  @State private var created: (res: AuthResponse, code: String)?
  @State private var email = ""
  @State private var code = ""
  /// Where the code went; nil until one is sent.
  @State private var codeSentTo: String?
  @State private var busy = false
  @State private var error: String?

  @FocusState private var focus: Field?
  private enum Field { case address, email, code, username, recovery, password, invite }

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

        if server == nil && purpose == .library {
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
    .onAppear {
      guard !addressLoaded else { return }
      addressLoaded = true
      address =
        purpose == .community
        ? session.communityServer?.host() ?? "app.perch.ws"
        : UserDefaults.standard.url(forKey: "perch.server")?.absoluteString ?? ""
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
      if purpose == .community {
        Text("Your Perch account")
          .font(.title2.weight(.semibold))
          .multilineTextAlignment(.center)
        Text(
          "Your name for sharing notes as public pages. It doesn't sync your library, and you don't need it to read."
        )
        .font(.subheadline)
        .multilineTextAlignment(.center)
        .foregroundStyle(theme.muted)
      } else {
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
      Text(purpose == .community ? "Where your account is" : "Your Perch Server")
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
        if purpose == .community {
          Text("app.perch.ws, or a Perch Server of your own.")
        } else {
          #if targetEnvironment(simulator)
            Text(
              "The address of the Perch Server you or a friend runs. On the simulator, the Mac's own server is \(Self.localServer)."
            )
          #else
            Text("The address of the Perch Server you or a friend runs.")
          #endif
        }
        if localFeeds > 0 && purpose == .library {
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
      if purpose == .library && info.mode == .hub {
        throw APIError(
          status: 0, code: "hub",
          message: String(
            localized:
              "This server holds Perch accounts, not libraries. Sync with a chain, and sign in to it under Perch account to share notes."
          ))
      }
      guard info.mode == .personal || info.mode == .hub else {
        throw APIError(
          status: 0, code: "unsupported",
          message: String(localized: "This server runs in a mode this version of Perch can't use yet."))
      }
      server = (url, info)
      creating = info.needsSetup
      resetting = false
      codeSentTo = nil
      focus = byEmail(info) ? .email : .username
    }
  }

  // MARK: Step 2: the account

  @ViewBuilder
  private func accountForm(_ url: URL, _ info: ServerInfo) -> some View {
    if let created {
      VStack(alignment: .leading, spacing: 14) {
        Text("Save your recovery code").font(.headline)
        RecoveryCodeView(
          code: created.code, username: created.res.user.username,
          host: url.host() ?? url.absoluteString
        ) {
          if purpose == .community {
            session.adoptCommunity(server: url, created.res)
            dismiss()
          } else {
            Task { await session.finishSignUp(server: url, created.res) }
          }
        }
      }
    } else {
      signInForm(url, info)
    }
  }

  @ViewBuilder
  private func signInForm(_ url: URL, _ info: ServerInfo) -> some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        VStack(alignment: .leading, spacing: 2) {
          Text(title(info))
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

      if byEmail(info) && codeSentTo == nil {
        emailStep(url)
      } else {
        credentials(url, info)
      }

      if codeSentTo != nil {
        Button("Use a different address or send a new code") {
          codeSentTo = nil
          code = ""
          error = nil
          focus = .email
        }
        .font(.footnote.weight(.medium))
        .frame(maxWidth: .infinity)
      }
      if !creating && !resetting && !recovering && (info.email == true || info.recovery == true) {
        Button("Forgot your password?") {
          switchTo(resetting: info.email == true, recovering: info.email != true)
        }
        .font(.footnote.weight(.medium))
        .frame(maxWidth: .infinity)
      }
      if resetting && info.recovery == true {
        Button("Use your recovery code instead") { switchTo(recovering: true) }
          .font(.footnote.weight(.medium))
          .frame(maxWidth: .infinity)
      }
      if recovering && info.email == true {
        Button("Get a code by email instead") { switchTo(resetting: true) }
          .font(.footnote.weight(.medium))
          .frame(maxWidth: .infinity)
      }
      if !info.needsSetup && (info.signup != .closed || resetting || recovering) {
        Button(
          creating || resetting || recovering ? "I already have an account" : "Create an account"
        ) {
          switchTo(creating: !(creating || resetting || recovering))
        }
        .font(.footnote.weight(.medium))
        .frame(maxWidth: .infinity)
      }
    }
  }

  private func title(_ info: ServerInfo) -> LocalizedStringKey {
    if info.needsSetup { return "Set up your server" }
    if resetting || recovering { return "Reset your password" }
    return creating ? "Create an account" : "Sign in"
  }

  /// Ask for the address the code goes to.
  @ViewBuilder
  private func emailStep(_ url: URL) -> some View {
    Text(
      resetting
        ? "We'll email you a code to set a new password."
        : "This server confirms your email address before you sign up. We'll send you a code."
    )
    .font(.footnote)
    .foregroundStyle(theme.muted)
    TextField("Email", text: $email)
      .textContentType(.emailAddress)
      .keyboardType(.emailAddress)
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled()
      .focused($focus, equals: .email)
      .submitLabel(.send)
      .onSubmit { sendCode(url) }
      .fieldStyle()
    primaryButton("Send code") { sendCode(url) }
      .disabled(email.trimmingCharacters(in: .whitespaces).isEmpty)
  }

  @ViewBuilder
  private func credentials(_ url: URL, _ info: ServerInfo) -> some View {
    if let codeSentTo {
      Text("We sent a 6-digit code to \(codeSentTo). It works for 10 minutes.")
        .font(.footnote)
        .foregroundStyle(theme.muted)
      TextField("Code", text: $code)
        .textContentType(.oneTimeCode)
        .keyboardType(.numberPad)
        .focused($focus, equals: .code)
        .fieldStyle()
    }
    if recovering {
      Text("Enter your username, the recovery code you saved when you made the account, and a new password.")
        .font(.footnote)
        .foregroundStyle(theme.muted)
    }
    if !resetting {
      HStack(spacing: 10) {
        TextField("Username", text: $username)
          .textContentType(.username)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .focused($focus, equals: .username)
          .submitLabel(.next)
          .onSubmit { focus = recovering ? .recovery : .password }
          .fieldStyle()
        if creating {
          Button("Suggest", systemImage: "dice") { username = UsernameSuggestion.make() }
            .labelStyle(.iconOnly)
            .buttonStyle(.glass)
            .accessibilityLabel("Suggest a username")
        }
      }
      if creating {
        Text("Your username is shown on notes you share. Don't use your real name or anything that identifies you.")
          .font(.footnote)
          .foregroundStyle(theme.muted)
      }
    }
    if recovering {
      TextField("Recovery code", text: $recoveryInput)
        .textInputAutocapitalization(.characters)
        .autocorrectionDisabled()
        .focused($focus, equals: .recovery)
        .submitLabel(.next)
        .onSubmit { focus = .password }
        .fieldStyle()
    }
    SecureField(resetting || recovering ? "New password" : "Password", text: $password)
      .textContentType(creating || resetting || recovering ? .newPassword : .password)
      .focused($focus, equals: .password)
      .submitLabel(creating && needsInvite(info) ? .next : .go)
      .onSubmit {
        if creating && needsInvite(info) { focus = .invite } else { submit(url, info) }
      }
      .fieldStyle()
    if creating && needsInvite(info) {
      TextField("Invite code", text: $invite)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .focused($focus, equals: .invite)
        .submitLabel(.go)
        .onSubmit { submit(url, info) }
        .fieldStyle()
    }

    primaryButton(
      resetting || recovering ? "Set new password" : creating ? "Create account" : "Sign in"
    ) {
      submit(url, info)
    }
    .disabled((!resetting && username.isEmpty) || password.isEmpty)
  }

  private func needsInvite(_ info: ServerInfo) -> Bool {
    !info.needsSetup && info.signup == .invite
  }

  /// Signing up on an email-signup server, or resetting a password, starts with a code.
  private func byEmail(_ info: ServerInfo) -> Bool {
    resetting || (creating && info.signup == .email)
  }

  private func switchTo(creating: Bool = false, resetting: Bool = false, recovering: Bool = false) {
    self.creating = creating
    self.resetting = resetting
    self.recovering = recovering
    codeSentTo = nil
    code = ""
    error = nil
  }

  private func sendCode(_ url: URL) {
    let address = email.trimmingCharacters(in: .whitespaces)
    guard !address.isEmpty else { return }
    run {
      try await APIClient(baseURL: url).requestEmailCode(
        email: address, purpose: resetting ? .reset : .signup,
        lang: Locale.current.language.languageCode?.identifier)
      codeSentTo = address
      focus = .code
    }
  }

  private func submit(_ url: URL, _ info: ServerInfo) {
    guard resetting || !username.isEmpty, !password.isEmpty else { return }
    if (creating || resetting || recovering) && password.count < 8 {
      error = String(localized: "Use at least 8 characters for your password.")
      return
    }
    let emailCode = code.filter(\.isNumber)
    if codeSentTo != nil && emailCode.isEmpty {
      error = String(localized: "Enter the code from the email.")
      return
    }
    if recovering && RecoveryCode.normalize(recoveryInput) == nil {
      error = String(localized: "That doesn't look like a recovery code.")
      return
    }
    run {
      if purpose == .community && !creating {
        if recovering {
          try await session.communityRecover(
            server: url, username: username, recoveryCode: recoveryInput, password: password)
        } else if resetting, let codeSentTo {
          try await session.communityResetPassword(
            server: url, email: codeSentTo, code: emailCode, password: password)
        } else {
          try await session.communitySignIn(server: url, username: username, password: password)
        }
        dismiss()
      } else if recovering {
        try await session.recover(
          server: url, username: username, recoveryCode: recoveryInput, password: password)
      } else if resetting, let codeSentTo {
        try await session.resetPassword(
          server: url, email: codeSentTo, code: emailCode, password: password)
      } else if creating {
        let recoveryCode = info.recovery == true ? RecoveryCode.new() : nil
        let res = try await session.register(
          server: url, info: info, username: username, password: password, invite: invite,
          email: codeSentTo, emailCode: codeSentTo == nil ? nil : emailCode,
          recoveryCode: recoveryCode)
        if let recoveryCode {
          created = (res, recoveryCode)
        } else if purpose == .community {
          session.adoptCommunity(server: url, res)
          dismiss()
        } else {
          await session.finishSignUp(server: url, res)
        }
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
