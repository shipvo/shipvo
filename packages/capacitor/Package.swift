// swift-tools-version:5.9
// Entry point for Capacitor's Swift Package Manager integration (`cap sync ios` links this package).
// The sources live in ios/Sources; ios/Package.swift runs the same ShipvoBundle target's tests.
import PackageDescription

let package = Package(
  name: "ShipvoCapacitor",
  platforms: [.iOS(.v15)],
  products: [.library(name: "ShipvoCapacitor", targets: ["ShipvoCapacitor"])],
  dependencies: [.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")],
  targets: [
    .target(name: "ShipvoBundle", path: "ios/Sources/ShipvoBundle"),
    .target(
      name: "ShipvoCapacitor",
      dependencies: [.product(name: "Capacitor", package: "capacitor-swift-pm"), "ShipvoBundle"],
      path: "ios/Sources/ShipvoCapacitor"
    ),
  ]
)
