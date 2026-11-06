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

## Events

The runtime reports refused and reverted releases for you. `Runtime.markHealthy()` and every `Runtime.checkForUpdate()` drain the device's event queue and send each event to `POST {baseUrl}/t`, using `baseUrl` and `appId` from `expo.extra.shipvo`. A refusal found during a background check is reported in the same session, without a restart.

Forwarded events: `crash_loop_revert`, `rolled_back`, `verify_failed`, `download_failed`, `hermes_bytecode_mismatch`, `native_module_missing`, `native_module_version`. `verify_failed`, `download_failed` and `hermes_bytecode_mismatch` are reported under the failed release id. The native-module reasons arrive as `pointer_rejected:<reason>` and are reported under the reason name. Sending is best effort: a failed send never throws and never blocks.

```ts
import { reportRuntimeEvents, onRuntimeEvents } from "@shipvo/runtime";
reportRuntimeEvents();                       // drain and send now (markHealthy and checkForUpdate already do)
onRuntimeEvents((events) => console.log(events)); // see the drained strings, for a log
```

To turn the automatic report off, pass `reportEvents: false` to the config plugin (it lands in `expo.extra.shipvo`), and call `reportRuntimeEvents()` yourself. `forwardRuntimeEvents(events, send)` and `FORWARDED_EVENTS` are also exported for custom senders. If you call `Runtime.consumeEvents()` yourself, you take events away from the report.

The runtime does not emit `download_failed` yet. The control plane accepts it.
