# @shipvo/runtime

The native half of Shipvo's over-the-air updates, as an Expo module.

- Verifies every release pointer (Ed25519) and bundle (SHA-256 + size) against a public key built into the shell.
- Downloads bsdiff patches when it has the previous release, full bundles otherwise; stages atomically.
- Applies without restart, marks the release healthy when the app says so, and discards a release that fails to boot 3 times.
- Android and iOS. iOS applies patches from the bundle it is running (not yet from the app's embedded bundle) and downloads the full bundle otherwise. It is verified on the iOS Simulator in CI; in the web simulator the app runs the same release as the web build.

```json
{ "expo": { "plugins": [["@shipvo/runtime", { "baseUrl": "https://<your control plane>", "publicKey": "<base64 Ed25519 public key>", "appId": "myshop" }]] } }
```

Optional plugin props declare what the shell can run, so the control plane can skip releases it cannot use:

```json
{ "hermesBytecodeVersions": [96], "nativeModules": { "react-native-mmkv": "3.1.0" } }
```

They are written as Android meta-data `dev.shipvo.HERMES_BYTECODE_VERSIONS` (`96`) and `dev.shipvo.NATIVE_MODULES` (`react-native-mmkv@3.1.0`), and as Info.plist keys `ShipvoHermesBytecodeVersions` and `ShipvoNativeModules`. Leave them out and nothing is written. A non-integer version or an empty package name fails the build. The runtime does not read them yet.

```ts
import { Runtime } from "@shipvo/runtime";
const s = Runtime.getState();            // running / pending / previous release, band, baseUrl, appId
await Runtime.checkForUpdate(true);      // verify, download (patch if possible), stage, apply
Runtime.markHealthy();                   // call once the first screen rendered
```

`shipvo init` wires all of this for you.

## Events to forward

`Runtime.consumeEvents()` returns strings such as `verify_failed:<release>`. Forward `crash_loop_revert`, `rolled_back` and `verify_failed` to telemetry (`POST /t`), once per event. The sample app does this in `apps/tide-and-tackle/src/runtimeEvents.ts`. `verify_failed` is reported under the failed release id. A rejected or corrupt release then shows on the server, not only as repeated downloads.

The runtime does not emit `download_failed` yet. The sample app and the control plane accept it, so it can be forwarded once the runtime raises it.

`Runtime.consumeEvents()` can also return `pointer_rejected:<reason>` (`hermes_bytecode_mismatch`, `native_module_missing` or `native_module_version`) on Android when the control plane says this shell cannot run the newest release. It is queued once per reason and is not accepted by `/t`, so do not forward it yet.

Events are read at launch. A `verify_failed` raised during `checkForUpdate` is reported on the next cold start.

## Crash after `markHealthy`

`markHealthy` means the first screen rendered. It promotes a staged release, but it does not clear the unhealthy-boot count. The count is cleared when the app has stayed in the foreground for 30 seconds, or when it goes to background. If the process dies before that, the next launch counts as an unhealthy boot for that release. After 3 unhealthy boots inside 60 seconds the runtime blocks the release, goes back to the previous one and records `crash_loop_revert`.

A good release that you open and kill in the foreground within 30 seconds, 4 times in 60 seconds, is reverted too. This is rare.

Reverting does not undo changes the bad release made to app storage (files, databases, keychain, preferences). Write migrations so an older release can read newer data.
