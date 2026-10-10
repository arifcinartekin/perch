import LocalAuthentication
import SwiftUI

/// Covers the app while it's locked: a PIN pad, and Face ID or Touch ID.
struct LockScreen: View {
  @Environment(AppLock.self) private var lock
  @Environment(\.colorScheme) private var colorScheme
  @State private var pin = ""
  @State private var shake = 0
  @State private var message: LocalizedStringKey?

  var body: some View {
    let theme = AppTheme.forScheme(colorScheme)
    VStack(spacing: 28) {
      Spacer()
      PerchMarkDrawing(colors: theme.logo)
        .frame(width: 64)
      VStack(spacing: 8) {
        Text("Enter your PIN")
          .font(.title3.weight(.semibold))
        Text(message ?? " ")
          .font(.footnote)
          .foregroundStyle(theme.muted)
      }
      PinDots(count: pin.count)
        .modifier(Shake(times: shake))
      PinPad(
        pin: $pin,
        biometry: lock.useBiometrics ? lock.biometry : nil,
        onBiometrics: { Task { await lock.unlockWithBiometrics() } }
      )
      Spacer()
    }
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .foregroundStyle(theme.text)
    .background { Backdrop() }
    .environment(\.theme, theme)
    .onChange(of: pin) { _, value in
      guard value.count == 6 else { return }
      if lock.unlock(with: value) {
        pin = ""
      } else {
        withAnimation(.default) { shake += 1 }
        pin = ""
        message =
          lock.blockedUntil != nil ? "Too many tries. Wait a moment." : "That PIN isn't right."
      }
    }
    .task { await lock.unlockWithBiometrics() }
  }
}

/// Hides the app's content in the app switcher when the lock is on.
struct PrivacyCover: View {
  @Environment(\.colorScheme) private var colorScheme
  var body: some View {
    let theme = AppTheme.forScheme(colorScheme)
    PerchMarkDrawing(colors: theme.logo)
      .frame(width: 64)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background { Backdrop().environment(\.theme, theme) }
  }
}

struct PinDots: View {
  let count: Int
  var body: some View {
    HStack(spacing: 16) {
      ForEach(0..<6, id: \.self) { i in
        Circle()
          .strokeBorder(.primary.opacity(0.5), lineWidth: 1.5)
          .background(Circle().fill(i < count ? Color.primary : .clear))
          .frame(width: 14, height: 14)
      }
    }
    .accessibilityElement()
    .accessibilityLabel(Text("\(count) of 6 digits entered"))
  }
}

/// Digits, delete, and (when on) Face ID / Touch ID.
struct PinPad: View {
  @Binding var pin: String
  var biometry: LABiometryType? = nil
  var onBiometrics: () -> Void = {}

  private let rows = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]]

  var body: some View {
    VStack(spacing: 14) {
      ForEach(rows, id: \.self) { row in
        HStack(spacing: 22) { ForEach(row, id: \.self, content: digit) }
      }
      HStack(spacing: 22) {
        if let biometry {
          key(Image(systemName: biometry == .faceID ? "faceid" : "touchid"), onBiometrics)
            .accessibilityLabel(biometry == .faceID ? "Face ID" : "Touch ID")
        } else {
          Color.clear.frame(width: 76, height: 76)
        }
        digit("0")
        key(Image(systemName: "delete.left"), { if !pin.isEmpty { pin.removeLast() } })
          .accessibilityLabel("Delete")
          .opacity(pin.isEmpty ? 0.3 : 1)
      }
    }
  }

  private func digit(_ d: String) -> some View {
    key(Text(d).font(.title.weight(.medium)), { if pin.count < 6 { pin.append(d) } })
  }

  private func key(_ label: some View, _ action: @escaping () -> Void) -> some View {
    Button(action: action) {
      label
        .font(.title2)
        .frame(width: 76, height: 76)
        .contentShape(.circle)
    }
    .buttonStyle(.glass)
    .clipShape(.circle)
  }
}

private struct Shake: GeometryEffect {
  var times: Int
  var animatableData: CGFloat {
    get { CGFloat(times) }
    set { times = Int(newValue) }
  }
  var progress: CGFloat = 0
  func effectValue(size: CGSize) -> ProjectionTransform {
    ProjectionTransform(CGAffineTransform(translationX: 8 * sin(animatableData * .pi * 4), y: 0))
  }
}

/// Settings → App lock.
struct AppLockSettingsView: View {
  @Environment(AppLock.self) private var lock
  @Environment(\.theme) private var theme
  @State private var settingPin = false
  @State private var confirmingOff = false

  var body: some View {
    @Bindable var lock = lock
    Form {
      Section {
        Toggle(
          "PIN lock",
          isOn: Binding(
            get: { lock.isEnabled },
            set: { on in if on { settingPin = true } else { confirmingOff = true } })
        )
        .surfaceRow()
        if lock.isEnabled {
          Button("Change PIN…") { settingPin = true }
            .surfaceRow()
        }
      } footer: {
        Text(
          "A 6-digit PIN in front of Perch, so someone picking up your phone can't open your reading. It hides the app; it doesn't encrypt what's on the phone. Widgets and notifications still show headlines."
        )
      }

      if lock.isEnabled {
        if let biometry = lock.biometry {
          Section {
            Toggle(biometry == .faceID ? "Unlock with Face ID" : "Unlock with Touch ID", isOn: $lock.useBiometrics)
              .surfaceRow()
          }
        }
        Section {
          Picker("Lock", selection: $lock.grace) {
            Text("Immediately").tag(AppLock.Grace.immediately)
            Text("After 1 minute").tag(AppLock.Grace.oneMinute)
            Text("After 5 minutes").tag(AppLock.Grace.fiveMinutes)
            Text("After 15 minutes").tag(AppLock.Grace.fifteenMinutes)
          }
          .surfaceRow()
        } footer: {
          Text("How long Perch can be in the background before it asks again.")
        }
      }
    }
    .perchBackdrop()
    .navigationTitle("App lock")
    .navigationBarTitleDisplayMode(.inline)
    .sheet(isPresented: $settingPin) { SetPinView() }
    .sheet(isPresented: $confirmingOff) {
      VerifyPinView(title: "Turn off PIN lock") { lock.turnOff() }
    }
  }
}

/// Choose a PIN: once, then again.
struct SetPinView: View {
  @Environment(AppLock.self) private var lock
  @Environment(\.dismiss) private var dismiss
  @State private var first: String?
  @State private var pin = ""
  @State private var message: LocalizedStringKey?

  var body: some View {
    NavigationStack {
      VStack(spacing: 24) {
        Text(first == nil ? "Choose a 6-digit PIN" : "Enter it again")
          .font(.title3.weight(.semibold))
          .padding(.top, 24)
        Text(message ?? " ").font(.footnote).foregroundStyle(.secondary)
        PinDots(count: pin.count)
        PinPad(pin: $pin)
        Spacer()
      }
      .frame(maxWidth: .infinity)
      .background { Backdrop() }
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", systemImage: "xmark") { dismiss() }
        }
      }
      .onChange(of: pin) { _, value in
        guard value.count == 6 else { return }
        if let first {
          if first == value {
            lock.setPin(value)
            dismiss()
          } else {
            self.first = nil
            message = "The PINs didn't match. Try again."
          }
        } else {
          first = value
          message = nil
        }
        pin = ""
      }
    }
  }
}

/// Asks for the current PIN (or Face ID) before a change.
struct VerifyPinView: View {
  @Environment(AppLock.self) private var lock
  @Environment(\.dismiss) private var dismiss
  let title: LocalizedStringKey
  let onVerified: () -> Void
  @State private var pin = ""
  @State private var message: LocalizedStringKey?

  var body: some View {
    NavigationStack {
      VStack(spacing: 24) {
        Text("Enter your PIN").font(.title3.weight(.semibold)).padding(.top, 24)
        Text(message ?? " ").font(.footnote).foregroundStyle(.secondary)
        PinDots(count: pin.count)
        PinPad(pin: $pin)
        Spacer()
      }
      .frame(maxWidth: .infinity)
      .background { Backdrop() }
      .navigationTitle(title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", systemImage: "xmark") { dismiss() }
        }
      }
      .onChange(of: pin) { _, value in
        guard value.count == 6 else { return }
        if lock.verify(value) {
          onVerified()
          dismiss()
        } else {
          message =
            lock.blockedUntil != nil ? "Too many tries. Wait a moment." : "That PIN isn't right."
        }
        pin = ""
      }
    }
  }
}
