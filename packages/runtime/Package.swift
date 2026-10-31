// swift-tools-version:5.9
// Test-only package: compiles the runtime's platform-neutral logic (state, verification, updater, bundle choice) and
// runs it under `swift test` on macOS CI. The app itself builds these same files through the CocoaPods podspec.
import PackageDescription

let package = Package(
  name: "ShipvoRuntimeCore",
  platforms: [.macOS(.v13)],
  targets: [
    .target(name: "ShipvoCore", path: "ios", exclude: ["ShipvoRuntime.podspec", "ShipvoRuntimeModule.swift", "ShipvoReactDelegateHandler.swift"], sources: ["Store.swift", "Verify.swift", "Updater.swift", "BundleSelector.swift"]),
    .testTarget(name: "ShipvoCoreTests", dependencies: ["ShipvoCore"], path: "ios-tests"),
  ]
)
