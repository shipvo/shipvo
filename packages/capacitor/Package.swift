// swift-tools-version: 5.9
import PackageDescription

// The iOS half of @shipvo/capacitor. `ShipvoBundle` has no Capacitor code, so it builds and tests anywhere.
// `ShipvoPlugin` needs UIKit and is added only when this manifest is read on macOS.
var products: [Product] = []
var dependencies: [Package.Dependency] = []
var targets: [Target] = [
    .target(name: "ShipvoBundle", path: "ios/Sources/ShipvoBundle"),
    .testTarget(
        name: "ShipvoBundleTests",
        dependencies: ["ShipvoBundle"],
        path: "ios/Tests/ShipvoBundleTests"
    ),
]
#if os(macOS)
products.append(.library(name: "ShipvoCapacitor", targets: ["ShipvoPlugin"]))
dependencies.append(.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.6.0"))
targets.append(.target(
    name: "ShipvoPlugin",
    dependencies: [
        "ShipvoBundle",
        .product(name: "Capacitor", package: "capacitor-swift-pm"),
        .product(name: "Cordova", package: "capacitor-swift-pm"),
    ],
    path: "ios/Sources/ShipvoPlugin"
))
#endif

let package = Package(
    name: "ShipvoCapacitor",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: products,
    dependencies: dependencies,
    targets: targets
)
