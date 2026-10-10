import PerchKit
import SwiftUI
import VisionKit

/// Scans a sync chain's QR code with the camera and hands back its link.
/// Nothing leaves the phone: VisionKit reads the code on the device.
struct ChainQRScanner: View {
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  let onFound: (URL) -> Void

  var body: some View {
    NavigationStack {
      Group {
        if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
          ScannerRepresentable { url in
            onFound(url)
            dismiss()
          }
          .ignoresSafeArea()
          .overlay(alignment: .bottom) {
            Text("Point the camera at the chain's QR code, shown on the device that started it.")
              .font(.footnote)
              .multilineTextAlignment(.center)
              .padding(14)
              .glassEffect(.regular, in: .rect(cornerRadius: 18))
              .padding()
          }
        } else {
          ContentUnavailableView(
            "Can't scan here", systemImage: "camera.slash",
            description: Text(
              "Allow Perch to use the camera in Settings, or type the chain's code instead."))
        }
      }
      .navigationTitle("Scan QR code")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", systemImage: "xmark") { dismiss() }
        }
      }
    }
  }
}

private struct ScannerRepresentable: UIViewControllerRepresentable {
  let onFound: (URL) -> Void

  func makeUIViewController(context: Context) -> DataScannerViewController {
    let scanner = DataScannerViewController(
      recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced,
      isHighlightingEnabled: true)
    scanner.delegate = context.coordinator
    try? scanner.startScanning()
    return scanner
  }

  func updateUIViewController(_ controller: DataScannerViewController, context: Context) {}

  static func dismantleUIViewController(_ controller: DataScannerViewController, coordinator: Coordinator) {
    controller.stopScanning()
  }

  func makeCoordinator() -> Coordinator { Coordinator(onFound: onFound) }

  final class Coordinator: NSObject, DataScannerViewControllerDelegate {
    let onFound: (URL) -> Void
    private var done = false

    init(onFound: @escaping (URL) -> Void) { self.onFound = onFound }

    func dataScanner(
      _ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem],
      allItems: [RecognizedItem]
    ) {
      for item in addedItems {
        // Only a Perch chain link counts; other QR codes are ignored.
        guard !done, case .barcode(let code) = item, let text = code.payloadStringValue,
          let url = URL(string: text), ChainCode.parseLink(url) != nil
        else { continue }
        done = true
        dataScanner.stopScanning()
        onFound(url)
      }
    }
  }
}
