import PerchKit
import PhotosUI
import SwiftUI

/// Theme, colours and glass (synced with the account, like Settings →
/// Appearance in the extension and web reader) and this phone's wallpaper.
struct AppearanceSettingsView: View {
  @Environment(Reader.self) private var reader
  @Environment(\.theme) private var theme
  @Environment(\.colorScheme) private var colorScheme
  /// Which mode's colours are being edited; follows the visible one at first.
  @State private var editing: ColorMode?
  @State private var saveTask: Task<Void, Never>?
  /// Settings as last saved, to roll back to if a debounced save fails.
  @State private var saved: SyncedSettings?

  var body: some View {
    let mode = editing ?? theme.palette.scheme
    let appearance = reader.settings.appearance ?? Appearance()
    let overrides = appearance[mode]
    let palette = Theme.palette(mode, overrides)

    Form {
      Section {
        PreviewCard()
          .listRowInsets(EdgeInsets())
          .listRowBackground(Color.clear)
      }

      Section("Theme") {
        Picker("Theme", selection: themeBinding) {
          Text("System").tag(SyncedSettings.Theme.system)
          Text("Light").tag(SyncedSettings.Theme.light)
          Text("Dark").tag(SyncedSettings.Theme.dark)
        }
        .pickerStyle(.segmented)
        .surfaceRow()
      }

      Section {
        Picker("Colors for", selection: Binding(get: { mode }, set: { editing = $0 })) {
          Text("Light theme").tag(ColorMode.light)
          Text("Dark theme").tag(ColorMode.dark)
        }
        .pickerStyle(.segmented)
        .surfaceRow()

        ColorRow(
          label: "Background",
          hint: "Text and borders adjust to stay readable on it.",
          value: palette.background, custom: overrides.background != nil,
          presets: Theme.backgroundPresets[mode] ?? []
        ) { setColor(mode, \.background, $0) }
        ColorRow(
          label: "Text",
          hint: "Titles and article text; secondary text is a softer shade.",
          value: palette.text, custom: overrides.text != nil,
          presets: Theme.textPresets[palette.scheme] ?? []
        ) { setColor(mode, \.text, $0) }
        ColorRow(
          label: "Accent",
          hint: "Unread dots, links, the tab bar and stars.",
          value: palette.accent, custom: overrides.accent != nil,
          presets: Theme.accentPresets
        ) { setColor(mode, \.accent, $0) }
        ColorRow(
          label: "Buttons",
          hint: "Filled buttons; their label colour is picked for contrast.",
          value: palette.button, custom: overrides.button != nil,
          presets: Theme.accentPresets
        ) { setColor(mode, \.button, $0) }

        if !overrides.isEmpty {
          Button("Reset \(mode.rawValue) theme colors", role: .destructive) {
            var a = appearance
            a[mode] = ColorOverrides()
            save(SyncedSettings(appearance: a), debounce: false)
          }
          .surfaceRow()
        }
      } header: {
        Text("Colors")
      } footer: {
        Text(
          "Light and dark keep their own colors. They sync with your account, so the extension and web reader match."
        )
      }

      GlassSection(save: { save(SyncedSettings(glass: $0), debounce: $1) })
      WallpaperSection()
    }
    .perchBackdrop()
    .navigationTitle("Appearance")
    .navigationBarTitleDisplayMode(.inline)
    .onDisappear { flush() }
  }

  private var themeBinding: Binding<SyncedSettings.Theme> {
    Binding(
      get: { reader.settings.theme ?? .system },
      set: { save(SyncedSettings(theme: $0), debounce: false) })
  }

  private func setColor(
    _ mode: ColorMode, _ key: WritableKeyPath<ColorOverrides, String?>, _ hex: String?
  ) {
    var a = reader.settings.appearance ?? Appearance()
    a[mode][keyPath: key] = hex.flatMap(Theme.normalizeHex)
    save(SyncedSettings(appearance: a), debounce: true)
  }

  /// Shows the change at once; saves it after a pause so dragging a picker
  /// doesn't send a request per frame.
  private func save(_ patch: SyncedSettings, debounce: Bool) {
    if saved == nil { saved = reader.settings }
    reader.previewSettings(patch)
    saveTask?.cancel()
    let before = saved
    saveTask = Task {
      if debounce {
        try? await Task.sleep(for: .milliseconds(500))
        guard !Task.isCancelled else { return }
      }
      await reader.updateSettings(pendingPatch, previousValue: before)
      saved = nil
    }
  }

  /// Everything this screen edits, so a debounced save never drops an
  /// earlier change.
  private var pendingPatch: SyncedSettings {
    SyncedSettings(
      theme: reader.settings.theme, appearance: reader.settings.appearance,
      glass: reader.settings.glass)
  }

  private func flush() {
    guard saveTask != nil, saved != nil else { return }
    saveTask?.cancel()
    let before = saved
    let patch = pendingPatch
    Task { await reader.updateSettings(patch, previousValue: before) }
    saved = nil
  }
}

/// A miniature of the reader in the current colours.
private struct PreviewCard: View {
  @Environment(\.theme) private var theme

  var body: some View {
    ZStack {
      Backdrop().clipShape(.rect(cornerRadius: 22))
      VStack(alignment: .leading, spacing: 10) {
        HStack(alignment: .top, spacing: 10) {
          Circle().fill(theme.accent).frame(width: 8, height: 8).padding(.top, 6)
          VStack(alignment: .leading, spacing: 3) {
            Text("The Perch Journal · 2 min. ago").font(.caption).foregroundStyle(theme.faint)
            Text("A calm place for your feeds").font(.body.weight(.semibold))
              .foregroundStyle(theme.text)
            Text("Read with a link to the original site.").font(.subheadline)
              .foregroundStyle(theme.muted)
          }
        }
        .padding(14)
        .background(Surface(shape: AnyShape(RoundedRectangle(cornerRadius: 16))))
        HStack {
          Text("A link").foregroundStyle(theme.accentText).underline()
          Spacer()
          Text("Button")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(theme.buttonContrast)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(theme.button, in: .capsule)
        }
        .padding(.horizontal, 4)
      }
      .padding(16)
    }
    .frame(height: 180)
    .accessibilityHidden(true)
  }
}

/// One colour: the system picker, the preset swatches, and "Default".
private struct ColorRow: View {
  @Environment(\.theme) private var theme
  let label: String
  let hint: String
  let value: String
  let custom: Bool
  let presets: [String]
  let onChange: (String?) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        VStack(alignment: .leading, spacing: 2) {
          Text(label)
          Text(hint).font(.footnote).foregroundStyle(theme.muted)
        }
        Spacer()
        if custom {
          Button("Default") { onChange(nil) }
            .font(.footnote.weight(.medium))
            .buttonStyle(.borderless)
        }
        ColorPicker(
          label,
          selection: Binding(get: { Color(hex: value) }, set: { onChange($0.hexString) }),
          supportsOpacity: false
        )
        .labelsHidden()
      }
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
          ForEach(presets, id: \.self) { hex in
            Button {
              onChange(hex)
            } label: {
              Circle()
                .fill(Color(hex: hex))
                .frame(width: 26, height: 26)
                .overlay(Circle().strokeBorder(theme.text.opacity(0.15)))
                .overlay {
                  if hex == value {
                    Circle().strokeBorder(theme.accent, lineWidth: 2).padding(-4)
                  }
                }
                .padding(4)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(hex)
          }
        }
      }
    }
    .padding(.vertical, 4)
    .surfaceRow()
  }
}

private struct GlassSection: View {
  @Environment(Reader.self) private var reader
  @Environment(\.theme) private var theme
  let save: (GlassSettings, _ debounce: Bool) -> Void

  var body: some View {
    let glass = (reader.settings.glass ?? .default).normalized
    Section {
      Toggle(
        "Glass effect",
        isOn: Binding(
          get: { glass.enabled },
          set: { on in
            var g = glass
            g.enabled = on
            save(g, false)
          })
      )
      .surfaceRow()
      if glass.enabled {
        SliderRow(label: "Transparency", value: glass.transparency, range: 0...100, unit: "%") {
          var g = glass
          g.transparency = $0
          save(g, true)
        }
        SliderRow(label: "Blur", value: glass.blur, range: 0...GlassSettings.maxBlur, unit: "") {
          var g = glass
          g.blur = $0
          save(g, true)
        }
      }
      if glass != .default {
        Button("Reset glass") { save(.default, false) }.surfaceRow()
      }
    } header: {
      Text("Glass")
    } footer: {
      Text(
        "How see-through and blurred the panels are. Off gives solid panels and bars. iOS's own Reduce Transparency setting also makes them solid."
      )
    }
  }
}

private struct WallpaperSection: View {
  @Environment(Reader.self) private var reader
  @Environment(\.theme) private var theme
  @State private var item: PhotosPickerItem?
  @State private var error: String?

  var body: some View {
    let device = reader.device
    let pickLabel = device.wallpaper == nil ? "Choose a photo…" : "Replace photo…"
    Section {
      PhotosPicker(selection: $item, matching: .images) {
        Label(pickLabel, systemImage: "photo")
      }
      .surfaceRow()
      if let image = device.wallpaper {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
          .frame(height: 120)
          .clipShape(.rect(cornerRadius: 14))
          .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
          .surfaceRow()
        SliderRow(
          label: "Dim", value: device.wallpaperDim * 100, range: 0...90, unit: "%"
        ) { device.wallpaperDim = $0 / 100 }
        SliderRow(label: "Blur", value: device.wallpaperBlur, range: 0...24, unit: "") {
          device.wallpaperBlur = $0
        }
        Button("Remove photo", role: .destructive) { device.removeWallpaper() }
          .surfaceRow()
      }
      if let error {
        Text(error).foregroundStyle(.red).surfaceRow()
      }
    } header: {
      Text("Background image")
    } footer: {
      Text("Shown behind every screen on this iPhone only. Panels turn translucent over it.")
    }
    .onChange(of: item) { _, item in
      guard let item else { return }
      Task {
        do {
          guard let data = try await item.loadTransferable(type: Data.self) else { return }
          try device.setWallpaper(data)
          error = nil
        } catch {
          self.error = error.localizedDescription
        }
        self.item = nil
      }
    }
  }
}

/// A labelled slider that saves as it moves.
struct SliderRow: View {
  @Environment(\.theme) private var theme
  let label: String
  let value: Double
  let range: ClosedRange<Double>
  let unit: String
  let onChange: (Double) -> Void
  @State private var draft: Double?

  var body: some View {
    HStack(spacing: 12) {
      Text(label).frame(width: 100, alignment: .leading)
      Slider(
        value: Binding(
          get: { draft ?? value },
          set: {
            draft = $0.rounded()
            onChange($0.rounded())
          }), in: range, step: 1
      ) { editing in
        if !editing { draft = nil }
      }
      Text("\(Int(draft ?? value))\(unit)")
        .font(.footnote.monospacedDigit())
        .foregroundStyle(theme.muted)
        .frame(width: 44, alignment: .trailing)
    }
    .surfaceRow()
  }
}
