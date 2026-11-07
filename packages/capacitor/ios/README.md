# ShipvoBundle (iOS)

Swift package that verifies, stores and rolls back signed web bundles. It follows the same rules as the TypeScript core in `../src/engine.ts` and runs the shared vectors in `../test-vectors/bundle.json`.

Run the tests on a Mac with Xcode, or on Linux with a Swift toolchain:

```bash
cd packages/capacitor/ios
swift test
```

## Capacitor plugin

`Sources/ShipvoCapacitor` is the Capacitor plugin (`Shipvo`). It has the same methods and results as the Android plugin. `../Package.swift` exposes it to `cap sync ios`.
