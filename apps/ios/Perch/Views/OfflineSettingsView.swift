import PerchKit
import SwiftUI

/// What the phone keeps for reading without a connection.
struct OfflineSettingsView: View {
  @Environment(Reader.self) private var reader
  @Environment(\.theme) private var theme
  @State private var articles = 0
  @State private var bytes = 0
  @State private var pending = 0
  @State private var confirmingClear = false

  var body: some View {
    @Bindable var device = reader.device
    Form {
      Section {
        Toggle("Save articles for offline reading", isOn: $device.offlineEnabled)
          .surfaceRow()
        if device.offlineEnabled {
          Picker("Keep", selection: $device.offlineLimit) {
            ForEach(DeviceSettings.offlineLimits, id: \.self) { n in
              Text("\(n) newest").tag(n)
            }
          }
          .surfaceRow()
          Toggle("Include images", isOn: $device.offlineImages)
            .surfaceRow()
        }
      } footer: {
        Text(
          "Perch keeps your newest unread articles and every starred one on this iPhone, and refreshes them in the background. Images aren't downloaded in Low Data Mode."
        )
      }

      Section("On this iPhone") {
        LabeledContent("Articles", value: articles.formatted())
          .surfaceRow()
        LabeledContent("Storage", value: bytes.formatted(.byteCount(style: .file)))
          .surfaceRow()
        if pending > 0 {
          LabeledContent("Waiting to sync", value: "\(pending) changes")
            .surfaceRow()
        }
        Button {
          Task {
            await reader.downloadForOffline(force: true)
            await measure()
          }
        } label: {
          HStack {
            Text("Download now")
            Spacer()
            if reader.downloading { ProgressView() }
          }
        }
        .disabled(reader.downloading || reader.isOffline || !device.offlineEnabled)
        .surfaceRow()
        Button("Remove saved articles and images", role: .destructive) { confirmingClear = true }
          .surfaceRow()
      }
    }
    .perchBackdrop()
    .navigationTitle("Offline reading")
    .navigationBarTitleDisplayMode(.inline)
    .task { await measure() }
    .onChange(of: device.offlineLimit) { Task { await reader.downloadForOffline(force: true) } }
    .confirmationDialog(
      "Remove saved articles?", isPresented: $confirmingClear, titleVisibility: .visible
    ) {
      Button("Remove", role: .destructive) {
        Task {
          await reader.store.clear()
          await ImageCache.shared.clear()
          await measure()
        }
      }
    } message: {
      Text("Starred articles stay on your server. Changes not yet synced are kept.")
    }
  }

  private func measure() async {
    articles = await reader.store.articleCount()
    pending = await reader.store.pending().count
    bytes = await reader.store.sizeOnDisk() + (await ImageCache.shared.sizeOnDisk())
  }
}
