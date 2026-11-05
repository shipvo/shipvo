# Adapters: what a runtime port must do

This page is for a maintainer planning another runtime, such as the Capacitor adapter (epic #297). It lists what the current runtimes do, which release-decision rules exist, and where each one lives. It describes the code as it is. It does not propose moving anything.

There are two runtimes today: Android (Kotlin) and iOS (Swift). Both sit behind one JS API in TypeScript.

Paths are from the repository root.

## What an adapter must do

1. **Check.** Ask the control plane for the signed release pointer of this app, shell major and band. Android: `ShipvoRuntimeModule.check()` in `packages/runtime/android/src/main/java/dev/shipvo/runtime/ShipvoRuntimeModule.kt`. iOS: `Updater.check()` in `packages/runtime/ios/Updater.swift`.
2. **Verify.** Check the Ed25519 signature of the pointer body against the public key baked into the shell. Check the size and sha-256 of every downloaded file against the signed pointer. Android: `packages/runtime/android/src/main/java/dev/shipvo/runtime/Verify.kt`. iOS: `packages/runtime/ios/Verify.swift`. Do not edit these files as part of adapter work.
3. **Stage.** Download the bundle (a bsdiff patch if one fits, else the full file, resumable on Android and iOS), verify it, and write it as the pending release. Nothing runs yet.
4. **Apply.** Pick the bundle at load time: the pending release for up to three trial boots, else the current release, else the bundle embedded in the app. Reload without a restart when asked.
5. **Report.** `markHealthy` promotes a pending release that is the one running. Events (`applied`, `rolled_back`, `crash_loop_revert`, `verify_failed`, `pointer_rejected`, and so on) are queued on the device and read with `consumeEvents`.
6. **Roll back.** Revert to the previous release on crash loop or when the app calls `rollback`, and block that release so it is not fetched again.

The JS API every adapter must back is the `Native` type in `packages/runtime/src/index.ts`: `getState`, `checkForUpdate`, `markHealthy`, `consumeEvents`, `rollback`, `reload`, and optionally `noteCrash`. Where the native module is missing, `Runtime` falls back to a no-op (same file).

## Release-decision rules

"Shared" means one TypeScript implementation that every platform uses. "Per platform" means each runtime has its own copy, and an adapter must write another.

| # | Rule | Where it is decided | Shared or per platform |
|---|------|---------------------|------------------------|
| 1 | **Platform.** A pointer without `platform` is Android. A pointer with `platform: "ios"` is iOS. The control plane serves them from different paths (`/p/<app>/<major>/<band>` and `/p/<app>/<major>/ios/<band>`) and refuses to store a pointer whose `platform` does not match its path. | Pointer schema: `packages/schema/src/index.ts` (`ReleasePointer.platform`). Serve and store: `services/control-plane/src/index.ts` (`servePointer`), `services/control-plane/src/apps.ts` (pointer key check). On device, iOS refuses a pointer that is not `platform: "ios"` (`packages/runtime/ios/Updater.swift`). Android does not read `platform` on device. It relies on the path. | Shared (control plane) plus per platform (iOS device check) |
| 2 | **Major.** The pointer `app_id` and `shell_major` must equal the shell's own, or the pointer is refused. The shell major is also part of the pointer URL. | Android: `packages/runtime/android/src/main/java/dev/shipvo/runtime/ShipvoRuntimeModule.kt` (`check()`), `packages/runtime/android/src/main/java/dev/shipvo/runtime/Store.kt` (`shellMajor`, from manifest meta-data). iOS: `packages/runtime/ios/Updater.swift`, `packages/runtime/ios/Store.swift`. Schema field: `packages/schema/src/index.ts`. | Per platform |
| 3 | **Band.** A device picks a random cohort 0-999 once and keeps it. Cohort 0-9 is `b0`, 10-99 is `b1`, 100-999 is `b2`. The device asks for the pointer of its own band. | TypeScript: `bandForCohort` and `BAND_RANGES` in `packages/schema/src/index.ts`. The control plane exposes it in `services/control-plane/src/index.ts`. Devices do not call it. Android re-implements it in `packages/runtime/android/src/main/java/dev/shipvo/runtime/Store.kt` (`cohort`, `band`). iOS re-implements it in `packages/runtime/ios/Store.swift` (`cohort`, `band`). | Per platform (the TypeScript function is a reference, not used on device) |
| 4 | **Newer than known.** Skip a release that is not newer than the highest of current, pending and blocked. | Android: `check()` in `packages/runtime/android/src/main/java/dev/shipvo/runtime/ShipvoRuntimeModule.kt`, and `BootRules.mayStage` in `packages/runtime/android/src/main/java/dev/shipvo/runtime/BootRules.kt` inside the lock, right before staging. iOS: `Updater.check()` (`release <= known`). | Per platform |
| 5 | **Minimum shell version.** Refuse a release whose `min_shell_version` is above the installed app version. Pre-release tags are ignored. | Schema field: `packages/schema/src/index.ts`. Compare: `Verify.semverLess` in `packages/runtime/android/src/main/java/dev/shipvo/runtime/Verify.kt` (Android) and `packages/runtime/ios/Verify.swift` (iOS). | Per platform |
| 6 | **Bytecode match.** Refuse a release whose `hermes_bytecode_version` differs from the one in the shell's embedded bundle header. A missing value on either side means "unknown" and the release is allowed. A refused release is blocked and logged as `hermes_bytecode_mismatch`. | On device: `packages/runtime/android/src/main/java/dev/shipvo/runtime/HermesGuard.kt` (Android) and `packages/runtime/ios/HermesGuard.swift` (iOS), called from `check()` and `Updater.check()`. At the control plane: when the shell sends `?hbc=96,98`, a release outside that list gets a 404 with `hermes_bytecode_mismatch` (`servePointer` in `services/control-plane/src/index.ts`). The shell sends its versions from `dev.shipvo.HERMES_BYTECODE_VERSIONS` (`packages/runtime/android/src/main/java/dev/shipvo/runtime/Store.kt`) or `packages/runtime/ios/Store.swift`. Query building: `packages/runtime/android/src/main/java/dev/shipvo/runtime/PointerQuery.kt` (Android), `Updater.pointerURL` (iOS). Schema fields: `hermes_bytecode_version` in `ReleasePointer` and `hermes_bytecode_versions` in `ShellManifest`. | Control plane check is shared. Device check is per platform |
| 7 | **Capability match (native modules).** A release lists `required_native_modules` (name to semver range). A shell lists its `native_modules` (name to version). A missing module, or a version outside the range, means the release is not offered. Unknown on either side means offered. | Rule: `checkNativeModules` and `satisfiesRange` in `packages/schema/src/index.ts`, called by `servePointer` in `services/control-plane/src/index.ts` when the shell sends `?nm=`. The device only sends the list and reads the typed 404 answer (`PointerQuery.mismatchReason` in `packages/runtime/android/src/main/java/dev/shipvo/runtime/PointerQuery.kt`; `Updater.check()` on iOS). I found no on-device copy of the comparison. | Shared (TypeScript, on the control plane) |
| 8 | **Halted release.** A release the owner halted is not offered. | `services/control-plane/src/index.ts` (`halt/<app>` key in `servePointer`). | Shared (control plane) |
| 9 | **Patch choice.** Use a patch only if its `from_sha256` equals the sha-256 of the bundle the device runs (the current bundle, else the embedded one). Check the patch hash, then the rebuilt bundle's size and hash. On any failure, fall back to the full bundle. iOS also requires the patch to be smaller than the bundle. | Android: `check()` in `packages/runtime/android/src/main/java/dev/shipvo/runtime/ShipvoRuntimeModule.kt` and `packages/runtime/android/src/main/java/dev/shipvo/runtime/Patch.kt`. iOS: `Updater.patched` in `packages/runtime/ios/Updater.swift` and `packages/runtime/ios/Patch.swift`. | Per platform |
| 10 | **Trial boots.** A staged release gets 3 boots (`MAX_BOOTS` / `maxBoots`). After that it is dropped, blocked and logged as `crash_loop_revert`. | Android: `packages/runtime/android/src/main/java/dev/shipvo/runtime/ShipvoHostHandler.kt`. iOS: `BundleSelector.choose`. | Per platform |
| 11 | **Crash-loop window.** More than 3 unhealthy boots of the current release in 60 seconds reverts to the previous release and blocks the current one. | Android: `BootRules.countBoot` in `packages/runtime/android/src/main/java/dev/shipvo/runtime/BootRules.kt` (`WINDOW_MS` in `packages/runtime/android/src/main/java/dev/shipvo/runtime/ShipvoHostHandler.kt`). iOS: `BundleSelector.choose` (`windowSeconds`). | Per platform |
| 12 | **Promotion and stability.** `markHealthy` promotes a pending release only if it is the one running. The boot counter is cleared only after the app stays up 30 seconds, or goes to the background cleanly. An uncaught JS error cancels that (`noteCrash`). | Android: `packages/runtime/android/src/main/java/dev/shipvo/runtime/BootRules.kt` (`onHealthy`, `markStableIfHealthy`), `packages/runtime/android/src/main/java/dev/shipvo/runtime/ShipvoRuntimeModule.kt`. iOS: `BundleSelector.promoteIfRunning`, `BundleSelector.markStableIfHealthy`. JS hook: `installCrashHook` in `packages/runtime/src/index.ts`. | Per platform (the crash hook is shared) |
| 13 | **New shell resets state.** When the installed app version differs from the one the stored bundles were fetched under, all stored bundles and counters are deleted. | Android: `Store.resetForNewShell`. iOS: `Store.resetForNewShell`. | Per platform |
| 14 | **Rollback.** An app-called `rollback` drops the pending release, blocks the current one, and reverts to the previous one. | Android: `rollback` in `packages/runtime/android/src/main/java/dev/shipvo/runtime/ShipvoRuntimeModule.kt`, `ShipvoHostHandler.revertToPrevious`. iOS: `packages/runtime/ios/ShipvoRuntimeModule.swift`, `BundleSelector.revertToPrevious`. | Per platform |
| 15 | **Rejection events.** A typed 404 from the control plane (`hermes_bytecode_mismatch`, `native_module_missing`, `native_module_version`) returns `status: "none"` with a `reason`. Android queues `pointer_rejected:<reason>` once, not once per check. | Android: `PointerQuery.rejectionEvent`. iOS returns the reason; I did not find the queued event there. | Per platform |

Telemetry event names are in `packages/schema/src/index.ts` (`Telemetry.event`).

## What a Capacitor port would need to redo

From the table, these are per platform today, so a Capacitor adapter on each OS would have to write them again or call into the existing Kotlin and Swift:

- Pointer fetch, signature check and hash checks (rules 2, 4, 5, and Verify).
- Cohort and band choice (rule 3).
- Bytecode check against the embedded bundle (rule 6). Only needed if the Capacitor bundle is Hermes bytecode. A plain JS bundle has no header, so the check returns "unknown" and allows the release.
- Patch choice and apply (rule 9).
- Trial boots, crash-loop window, promotion, stability, new-shell reset and rollback (rules 10 to 14). These depend on how the host picks its bundle at load time. React Native uses `getJSBundleFile` (Android) and a React delegate handler (iOS). Capacitor loads web assets from a server path, so this hook is different and has not been looked at in this slice.
- The `Native` JS API (`packages/runtime/src/index.ts`).

These need no new work, because the control plane decides them (rules 1, 6 on the server side, 7, 8). The adapter must send `?hbc=` and `?nm=` and handle the typed 404:

- Platform paths and path/platform match.
- Native module match.
- Halted release.

## Gaps found

- Rule 3: `bandForCohort` in TypeScript is not used by either device. Three copies of the 10/100 thresholds exist (schema, `packages/runtime/android/src/main/java/dev/shipvo/runtime/Store.kt`, `packages/runtime/ios/Store.swift`).
- Rule 7: there is no on-device native module check. A shell that does not send `?nm=` is offered every release.
- Rule 1: Android does not check `platform` on device, iOS does.
- Rule 15: not matched between platforms (see above).

Slice 2 of #307 (moving code) is out of scope here.
