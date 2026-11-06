// swift-tools-version:5.9
// Bundle logic for the Capacitor iOS layer: verify, store, crash-loop count, rollback. No Capacitor or UIKit imports.
import PackageDescription

let package = Package(
  name: "ShipvoBundle",
  platforms: [.macOS(.v13), .iOS(.v15)],
  products: [.library(name: "ShipvoBundle", targets: ["ShipvoBundle"])],
  // CryptoKit ships with Apple platforms; swift-crypto gives the same API on Linux.
  dependencies: [.package(url: "https://github.com/apple/swift-crypto.git", from: "3.0.0")],
  targets: [
    .target(name: "ShipvoBundle", dependencies: [.product(name: "Crypto", package: "swift-crypto", condition: .when(platforms: [.linux]))]),
    .testTarget(name: "ShipvoBundleTests", dependencies: ["ShipvoBundle"]),
  ]
)
