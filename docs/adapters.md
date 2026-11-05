# Framework adapters

Shipvo's update core is meant to be reused. This page says what a second framework adapter (for example Capacitor, epic #297) must do, what is already shared, and what still has to be ported. It is written from the code in `packages/runtime`, `packages/schema` and the control plane as they are today.

## What an adapter must do

1. **Check.** Ask the control plane for the pointer of this app, shell major, platform and band. Send `?hbc=` and `?nm=` when the shell declares them. Treat 304 as "nothing new" and a typed 404 as "this shell cannot take the newest release".
2. **Verify.** Check the Ed25519 signature on the pointer body against the pinned public key, then check size and SHA-256 of the downloaded bundle (and of a patch, and of a patched result).
3. **Decide.** Apply the release rules to the verified pointer (see below).
4. **Stage.** Write the bundle to disk as "pending". Never overwrite the running bundle.
5. **Apply.** On the next start (or on reload), boot the pending bundle as a trial.
6. **Report.** Tell the app which events happened and send telemetry (`rolled_back`, `crash_loop_revert`, `verify_failed`, `pointer_rejected:*`).
7. **Roll back.** Count unhealthy boots; after too many in the window, go back to the previous release and block the bad one.

## Shared today, or available to adapters

| Rule | Where | Notes |
| --- | --- | --- |
| Pointer, envelope, band, telemetry shapes | [`packages/schema/src/index.ts`](../packages/schema/src/index.ts) | Zod schemas. `ReleasePointer` carries `platform`, `shell_major`, `min_shell_version`, `hermes_bytecode_version`, `required_native_modules`. |
| Band for a cohort (`bandForCohort`) | same file | Cohort 0-999: `b0` below 10, `b1` below 100, else `b2`. |
| Semver ranges and native-module match (`satisfiesRange`, `checkNativeModules`) | same file | Used by the control plane to answer 404 `native_module_missing` / `native_module_version`. |
| **Release decision** (`decideRelease`, `semverLess`), available to adapters | [`packages/runtime/src/decide.ts`](../packages/runtime/src/decide.ts) | New in slice 1. No React Native import. Tests: [`test/decide.test.ts`](../packages/runtime/test/decide.test.ts). Import it from `@shipvo/runtime/decide`. The main entry `@shipvo/runtime` also re-exports it, but that entry imports Expo. |

`decideRelease(pointer, shell)` runs these checks in order and returns `{ take: true }` or `{ take: false, reason }`:

1. `wrong_platform`: only for an iOS shell, when the pointer does not say `"ios"`. An Android shell does not check `platform`, as the real Android shell does not, so it takes an `"ios"` pointer.
2. `other_app_or_shell`: `app_id` or `shell_major` differs.
3. `not_newer`: `release` is not above the newest current, pending or blocked release.
4. `shell_too_old`: shell version is below `min_shell_version` (missing counts as `0.0.0`).
5. `hermes_bytecode_mismatch`: both bytecode versions are known and differ. The result has `block: true`: the shell must block that release number.

It does not verify signature, hash or size. Run it after the signature check.

The `./decide` export points at the `.ts` source, like the main entry, so a consumer needs a bundler that compiles TypeScript from `node_modules`.

## Not shared yet: only in Kotlin or Swift

The shipped shells do **not** call `decideRelease`. A native module cannot call TypeScript, so the same rules still exist in each shell. They match `decide.ts` by reading; nothing tests that yet.

| Rule | Android | iOS |
| --- | --- | --- |
| Check the pointer, app and shell major, newer than known, min shell version | [`ShipvoRuntimeModule.kt`](../packages/runtime/android/src/main/java/dev/shipvo/runtime/ShipvoRuntimeModule.kt) `check()` | [`Updater.swift`](../packages/runtime/ios/Updater.swift) `check()` |
| Platform check | None. Android pointers have no `platform` and the shell does not check it. | `Updater.swift`: pointer must say `"ios"` |
| Hermes bytecode check | [`HermesGuard.kt`](../packages/runtime/android/src/main/java/dev/shipvo/runtime/HermesGuard.kt) | [`HermesGuard.swift`](../packages/runtime/ios/HermesGuard.swift) |
| Pointer URL and typed 404 reasons | [`PointerQuery.kt`](../packages/runtime/android/src/main/java/dev/shipvo/runtime/PointerQuery.kt) | `Updater.swift` `pointerURL`, `check()` |
| Band from cohort | [`Store.kt`](../packages/runtime/android/src/main/java/dev/shipvo/runtime/Store.kt) `band` | [`Store.swift`](../packages/runtime/ios/Store.swift) `band` (a third copy of `bandForCohort`) |
| Native modules vs the release | Control plane only: [`services/control-plane/src/index.ts`](../services/control-plane/src/index.ts). The shell sends `nm=` and reads the 404; it does not compare. | same |
| Signature, hash, size | [`Verify.kt`](../packages/runtime/android/src/main/java/dev/shipvo/runtime/Verify.kt) | [`Verify.swift`](../packages/runtime/ios/Verify.swift) |
| Patch (bsdiff) and resumable download | `Patch.kt`, `ResumableDownload.kt` | `Patch.swift` |
| Stage, trial boots, crash-loop rollback | [`BootRules.kt`](../packages/runtime/android/src/main/java/dev/shipvo/runtime/BootRules.kt), [`ShipvoHostHandler.kt`](../packages/runtime/android/src/main/java/dev/shipvo/runtime/ShipvoHostHandler.kt) (3 boots in 60 s) | `Store.swift`, `BundleSelector.swift` |

Known differences a port must decide on: Android does not check `platform` (`decideRelease` mirrors this for an Android shell, so a new adapter that wants to reject the other platform's pointers must add that check itself); a version part that is not a whole number (such as `1x`) counts as 0 in `decideRelease`, `Verify.kt` and `Verify.swift` alike; Android reads `min_shell_version` with `body.getString`, which throws when the field is absent, so a pointer without it errors on Android instead of being cleanly rejected, while iOS defaults it to `0.0.0`.

## What a Capacitor adapter needs

- **Reuse as is:** the schema package, the control plane, `decideRelease` (if the plugin core is TypeScript; see the example below), the signing format and the pointer URL scheme.
  ```ts
  // Import the subpath. The main entry would pull in Expo.
  import { decideRelease, type PointerFields, type ShellFacts } from "@shipvo/runtime/decide";

  const pointer: PointerFields = { app_id: "tide", shell_major: 1, release: 4, min_shell_version: "1.0.0" };
  const shell: ShellFacts = { platform: "android", appId: "tide", shellMajor: 1, shellVersion: "1.0.2", knownRelease: 3 };

  decideRelease(pointer, shell); // { take: true }
  ```
- **Port per platform:** everything in the table above, in the plugin's native code (or in TypeScript where Capacitor allows it: a Capacitor plugin can do download and hash checks in JS, but signature checks should stay native with the pinned key).
- **Replace:** the React Native parts: bundle loading (`ShipvoHostHandler.kt`, `BundleSelector.swift`, `ShipvoReactDelegateHandler.swift`), the Expo config plugin (`app.plugin.js`), and the Hermes guard (a Capacitor app ships web assets, so `hermes_bytecode_version` would be absent and the guard is skipped).
- **Open question for later slices:** a Capacitor release is a folder of web assets, not one bundle file. The pointer's `core` is a single file today. That needs a design before code.

## Next slices

- Make the native shells and `decide.ts` share one list of test cases, so they cannot drift.
- Move `bandForCohort` use into the adapter contract (three copies today).
