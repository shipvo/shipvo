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

## Patches and memory (Android)

Applying a patch needs the base bundle, the patch and the new bundle in memory together. The runtime checks first. If they would use more than 40% of the app's heap limit, it skips the patch and downloads the full bundle. If the patch step runs out of memory anyway, it does the same. The update still lands and is verified the same way.

`checkForUpdate` reports what happened: `via` is `"full"` and `patchError` is `"over_memory_budget"` or `"out_of_memory"`. A patch that was applied has `via: "patch"` and `patchError: null`. Covered by `PatchStepTest.kt`.

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

## Signed telemetry

Call `enableSignedTelemetry` once at startup. The install registers once, keeps a secret key in your storage, and then signs each report. If registration fails, reports go out unsigned and the next launch tries again.

```ts
import { enableSignedTelemetry } from "@shipvo/runtime";
import AsyncStorage from "@react-native-async-storage/async-storage";

await enableSignedTelemetry({
  storage: AsyncStorage,
  registerUrl: "https://cp.example.com/t/register",
  // crypto: { randomBytes, hmacSha256 }  // React Native has no crypto.subtle, so pass your own
});
```

The sent body is the unsigned JSON with its closing `}` replaced by `,"sig":"<hex>"}`. The HMAC-SHA256 covers the unsigned JSON, closing `}` included. A second call replaces the first identity.

## Background loads

A silent push or a background task can start the app process with no screen. Shipvo runs the same bundle for that load, so background code uses the staged release. It does not count the load as a boot until the app can show a screen: on Android, a load counts at once when the process is in the foreground or visible while the bundle is chosen, and otherwise when the first activity is created or started; on iOS, a load counts at once unless the app is in the background, and otherwise when the app becomes active. Any number of background loads leave a release's trial boots at 0 and the release pending. The first load that shows a screen counts as boot 1.

`Runtime.markHealthy()` called in a background load (a headless task, or at module init) does not count the load, promote the release or start the stability timer. A background load that ends before a screen shows leaves the counters unchanged. Call it again when the first screen renders.

An uncaught JS error in a background load counts as one failed boot at once (the error hook is installed when `@shipvo/runtime` loads), so a release that crashes there is still rolled back. Three loads with a screen and no `markHealthy` still revert the release.

## Crash after `markHealthy`

`markHealthy` means the first screen rendered. It promotes a staged release, but it does not clear the unhealthy-boot count. The count is cleared when the app has stayed in the foreground for 30 seconds, or when it goes to background. If the process dies before that, the next launch counts as an unhealthy boot for that release. After 3 unhealthy boots inside 60 seconds the runtime blocks the release, goes back to the previous one and records `crash_loop_revert`.

A good release that you open and kill in the foreground within 30 seconds, 4 times in 60 seconds, is reverted too. This is rare.

Reverting does not undo changes the bad release made to app storage (files, databases, keychain, preferences). Write migrations so an older release can read newer data.
