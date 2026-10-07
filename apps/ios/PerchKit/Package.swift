// swift-tools-version: 6.2
// PerchKit: everything the iOS app shares with the rest of Perch that isn't UI —
// the server API, its types, and the client-side key derivation. Kept as a
// package so it builds and tests on the Mac with `swift test`.
import PackageDescription

let package = Package(
  name: "PerchKit",
  platforms: [.iOS(.v26), .macOS(.v26)],
  products: [.library(name: "PerchKit", targets: ["PerchKit"])],
  targets: [
    // The Argon2 reference implementation (P-H-C/phc-winner-argon2 20190702,
    // CC0 / Apache-2.0), portable C. Always built optimised: unoptimised, the
    // 64 MiB derivation takes several seconds in Debug.
    .target(
      name: "CArgon2",
      path: "Sources/CArgon2",
      exclude: ["LICENSE"],
      cSettings: [
        .define("ARGON2_NO_THREADS"),
        .unsafeFlags(["-O3"]),
      ]
    ),
    .target(name: "PerchKit", dependencies: ["CArgon2"]),
    .testTarget(name: "PerchKitTests", dependencies: ["PerchKit"]),
  ]
)
