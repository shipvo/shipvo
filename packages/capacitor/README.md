# @shipvo/capacitor

Signed over-the-air updates for the web bundle of a Capacitor app. It makes the same release decisions and keeps the same trust model as `@shipvo/runtime` (see `docs/adapters.md`).

The core is TypeScript and makes every decision: it verifies the signature and the hash, stages, promotes and rolls back. The native layer only stores bytes and switches the web view.

| Platform | Native layer |
|---|---|
| Android | `android/`: stores the verified bundle zip in app-private files and the state in SharedPreferences; switches the web view with `Bridge.setServerBasePath` to the unpacked bundle |
| iOS | `ios/` and `Package.swift`: stores the verified bundle zip in Application Support and the state in UserDefaults; switches the web view with `setServerBasePath` to the unpacked bundle. Same JavaScript core, same `boot` and `bootAndServe` calls as Android. |

## Android

`android/` is a Capacitor plugin named `Shipvo`. It backs `KeyValueStore` with SharedPreferences and `BundleFiles` with the app-private files directory, and points the web view at the staged bundle. A web bundle is a zip of your web assets with an `index.html` at its root.

1. Register it in `MainActivity` with `registerPlugin(ShipvoPlugin.class)` before `super.onCreate`.
2. Include the module in `settings.gradle` and add `implementation project(':shipvo-capacitor')` (see `apps/capacitor-sample/android`).
3. When the page loads, call `bootAndServe`. It runs `boot()` (rollback included) and tells native to serve the chosen file. Native checks the sha-256 the core verified once more before it unpacks, and refuses zip entries that leave the directory.

```ts
import { registerPlugin } from "@capacitor/core";
import { ShipvoCapacitor, NativeStore, NativeFiles, bootAndServe, bootAndSwitch } from "@shipvo/capacitor";
import type { ShipvoNativePlugin } from "@shipvo/capacitor";

const native = registerPlugin<ShipvoNativePlugin>("Shipvo");
const shipvo: ShipvoCapacitor = new ShipvoCapacitor({
  appId: "tide", shellMajor: 1, shellVersion: "1.2.0", platform: "android",
  publicKey: "<base64 Ed25519 key>", baseUrl: "https://cp.example.com",
  store: new NativeStore(native), files: new NativeFiles(native),
  onReload: async () => { await bootAndSwitch(shipvo, native); },
});
await bootAndServe(shipvo, native);
await shipvo.markHealthy();
```

Each launch starts on the embedded bundle, then `bootAndServe` switches to the pending or current release. The page of a served bundle runs the same code; it resumes the release `boot()` already chose and does not count another trial boot.

Tests: `pnpm --filter @shipvo/capacitor test` runs the stage, apply, crash and rollback sequence through the native bridge. The plugin's JVM tests run with `./gradlew :shipvo-capacitor:testDebugUnitTest` in `apps/capacitor-sample/android` (after `pnpm --filter capacitor-sample sync`).

## iOS

`ios/` is a Capacitor plugin named `Shipvo`, shipped as a Swift package (`Package.swift`, product `ShipvoCapacitor`). It backs `KeyValueStore` with UserDefaults and `BundleFiles` with the app's Application Support directory, and points the web view at the staged bundle. The zip reader, the DEFLATE decoder and the SHA-256 fallback are plain Swift, so the plugin adds no dependency besides Capacitor.

1. Install the package. `npx cap sync ios` adds the Swift package to your app.
2. Call `bootAndServe` when the page loads, exactly as on Android. Use `platform: "ios"` in the `ShipvoCapacitor` options (the sample app passes `Capacitor.getPlatform()`).

Native re-checks the sha-256 the core verified before it unpacks, refuses zip entries that leave the directory, and caps the unpacked size. The Android and iOS stores accept and refuse the same file names and hashes: both follow `test/vectors/bundle-store.json`, and `pnpm --filter @shipvo/capacitor test` checks both sources against it.

Tests: the core's apply, refuse and crash-loop rollback sequences run for `platform: "ios"` in `pnpm --filter @shipvo/capacitor test`. The Swift store tests run with `swift test` in `packages/capacitor`.

## Install

```bash
npm install @shipvo/capacitor
```

## Example

```ts
import { ShipvoCapacitor, MemoryStore, MemoryFiles } from "@shipvo/capacitor";

const shipvo = new ShipvoCapacitor({
  appId: "tide", shellMajor: 1, shellVersion: "1.2.0", platform: "android",
  publicKey: "<base64 Ed25519 key baked into the shell>",
  baseUrl: "https://cp.example.com",
  store: new MemoryStore(), files: new MemoryFiles(), // Android: NativeStore and NativeFiles
});

const { release, file } = await shipvo.boot();      // which bundle to serve
const r = await shipvo.checkForUpdate({ apply: false });
if (r.status === "staged") console.log("staged release", r.release);
await shipvo.markHealthy();                         // promotes a pending release that is running
console.log((await shipvo.consumeEvents()).events);
```

## How a web bundle is described

The signed release pointer has `kind: "web"` (new, optional field in `@shipvo/schema`). `core` is the one archive file: `url`, `size` and `sha256`. This package refuses a pointer without `kind: "web"`, so a React Native pointer cannot be replayed into a web shell.

## API

`ShipvoCapacitor` implements `ShipvoCapacitorPlugin`, the same methods as `Native` in `packages/runtime/src/index.ts`, all async:

| Method | What it does |
|---|---|
| `getState()` | Cohort, band, running, current, pending, previous and blocked release |
| `checkForUpdate({ apply })` | Fetch the pointer, verify, download, verify, stage. `apply: true` then calls `onReload` |
| `markHealthy()` | Promotes the pending release if it is the one running |
| `consumeEvents()` | Returns and clears queued events: `applied`, `rolled_back`, `crash_loop_revert`, `verify_failed`, `download_failed`, `pointer_rejected:<why>` |
| `rollback()` | Drops pending, blocks current, goes back to previous |
| `reload()` | Calls `onReload` |
| `boot()` | Native layer only. Picks pending (3 trial boots), else current, else the embedded bundle (`release 0`). Applies the crash-loop window and the new-shell reset |
| `markStable()` | Native layer only. Clears the boot counter after the app stayed up |

Checks, in order: Ed25519 signature of the exact body bytes (WebCrypto), kind, platform, app and major, band, newer than current/pending/blocked, `min_shell_version`, then size and sha-256 of the bundle. A bad signature or hash is never staged. A hash mismatch also blocks that release.

Not shared yet: bsdiff patches (rule 9) and Hermes bytecode (rule 6, not relevant to plain web assets). Needs Node 20+ or a web view with WebCrypto Ed25519.
