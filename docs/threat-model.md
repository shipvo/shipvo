# Threat model for signed updates

This page is for a security reviewer who wants to know what a stolen token or a bad server can and cannot do to the phones that run a Shipvo-updated app. It is written from the code and tests in this repository. Every claim below names a file and a test. Where nothing proves a claim, the row says **not covered**.

It does not cover SBOM, penetration test results or compliance programmes. None exist in this repository. To report a problem, see `SECURITY.md`.

## What is signed, and who checks it

| Thing | Signed by | Checked by | Code |
|---|---|---|---|
| Release pointer: a JSON `body` string plus an Ed25519 `signature` over the exact UTF-8 bytes of `body` | The publisher's seed, in `shipvo publish` | The device, with the public key pinned in the installed app. The control plane also checks it on upload. | `packages/schema/src/index.ts` (`ReleasePointer`, `SignedEnvelope`), `packages/cli/src/index.ts` (`signDoc`), `packages/runtime/android/src/main/java/dev/shipvo/runtime/Verify.kt`, `packages/runtime/ios/Verify.swift`, `services/control-plane/src/apps.ts` (`pointerProblem`) |
| Bundle hash and size (`core.sha256`, `core.size`) | Inside the signed pointer body | The device, after download and before staging | `ShipvoRuntimeModule.kt` (`check`), `packages/runtime/ios/Updater.swift` |
| Patch hash and the hash of the patched result | Inside the signed pointer body | The device | same files |
| Platform binding | `platform: "ios"` inside the signed body. Absent means Android. | iOS device: refuses a pointer without `platform: "ios"`. Control plane: the body platform must match the storage key. | `packages/runtime/ios/Updater.swift`, `apps.ts` |
| App, shell major, band | Inside the signed body | The device checks app and shell major. The control plane checks all three against the storage key. | `ShipvoRuntimeModule.kt`, `apps.ts` |
| Release number, `min_shell_version`, `hermes_bytecode_version` | Inside the signed body | The device | `ShipvoRuntimeModule.kt`, `HermesGuard.kt` |

The devices verify the bytes first and parse second, so there is no canonical-JSON step on the device. The Ed25519 code is the platform's own (CryptoKit on iOS, the `net.i2p.crypto.eddsa` library on Android).

The public key is written into the app at build time as native manifest meta-data (`dev.shipvo.PUBLIC_KEY` on Android). A release cannot change it. The control plane also refuses to register an app a second time with a different key (`public_key_mismatch` in `apps.ts`).

## Assets, actors and trust boundaries

Assets:

- **Publisher seed.** The Ed25519 private key. Only the seed can create a release that phones accept. It lives in your CI secrets or `.shipvo/seed.txt` (`packages/cli/src/config.ts`, `packages/cli/src/signing.ts`).
- **Pinned public key.** In every installed app. It cannot be rotated for apps already installed. Losing the seed means shipping a new store build.
- **Users' phones.** They run whatever JavaScript bundle passes the checks above, with the native permissions of the installed shell.

Actors and what each holds:

| Actor | Holds | Can do |
|---|---|---|
| Publisher (you, or your CI) | Seed and publish token | Sign and upload releases |
| Agent with a scoped token | The owner token or a publish token, **not** the seed | Whatever the control plane allows that token (see below) |
| Control plane | Stored pointers, bundles, the app's public key. Never the seed. | Serve, withhold or delay what was uploaded |
| Storage or CDN | The same bytes | Same as above, without the policy checks |
| Device | The pinned public key, the staged bundle | Decide whether to stage, run, or revert |

Trust boundaries, from least to most trusted:

1. The network and the CDN: not trusted. Everything the device downloads is checked against the signed pointer.
2. The control plane: trusted to be available and to apply policy (halts, approvals, bands). Not trusted for integrity.
3. The publisher's CI and seed: fully trusted. Everything else depends on this boundary holding.
4. The device: trusted to check, and to keep the staged release only if the app stays healthy.

## Threats

"Proof" gives the code that stops the threat and a test that exercises it. A test name in `Quotes` is the exact test title or function name.

| Threat | What stops it | Code | Test |
|---|---|---|---|
| **Stolen publish token** (without the seed) | The token can upload to the app's own key prefixes only. A pointer upload is refused unless its signature verifies against the app's registered public key, so the token cannot create a pointer phones would accept. The token cannot be used for another app. | `services/control-plane/src/apps.ts` (`publisher`, `keyAllowed`, `pointerProblem`) | `services/control-plane/test/audit.test.ts` "records nothing for a rejected publish" (a bad signature gets 422 and nothing is stored); "refuses another app's publish token". Forbidden key prefixes: **not covered** by a named test. |
| **Stolen publish token: what it can still do** | It can overwrite a stored pointer with an older pointer that was validly signed earlier (see "Replayed older release"). It can upload bundle bytes, but a bundle only runs if a signed pointer names its hash. It can set auto-halt config. | `apps.ts`, `services/control-plane/src/index.ts` (`haltConfigAuth`) | `services/control-plane/test/halt-config.test.ts` "halt-config route with a publish token". Overwriting with an older signed pointer: **not covered**. |
| **Stolen seed** | Nothing. Whoever has the seed can ship code to every installed copy of the app, within the bands your release policy allows. Release policy and approvals limit how fast it spreads, not whether it is accepted. | `services/control-plane/src/apps.ts` (`policyRefusal`, `proposeIfApprovalNeeded`) | `services/control-plane/test/release-policy.test.ts` "refuses b2 when maxBand is b1"; `services/control-plane/test/approval.test.ts` "above the band: 202, pointer unchanged, one proposed audit row". These slow a bad release down. They do not stop a stolen seed. |
| **Compromised control plane** or **storage/CDN** serving a forged pointer | The device verifies the Ed25519 signature with the pinned key and stages nothing if it fails. | `Verify.kt`, `Verify.swift`, `ShipvoRuntimeModule.kt`, `Updater.swift` | iOS: `packages/runtime/ios-tests/RuntimeTests.swift` `testRefusesWhatItCannotTrust` (case `bad-sig`) and `testRefusesAnotherKey`; `testKnownSignatureVector` (RFC 8032 vector). Android, on an emulator in CI: `scripts/android-e2e/run.mjs` scenario "tampered bundle rejected: bad signature", with `scripts/android-e2e/lib.test.mjs` "signature tamper fails verification". There is no JVM unit test of the Android signature check itself. |
| **Compromised control plane or CDN serving a changed bundle or patch** | The device checks size and SHA-256 of the bundle, of each patch, and of the patched result, and deletes the file on mismatch. | `ShipvoRuntimeModule.kt` (`check`), `Updater.swift` | iOS: `testRefusesWhatItCannotTrust` (`bad-hash`, `bad-size`), `testEmbeddedBaseWithAWrongResultHashStagesNothing`, `testCorruptPartialFailsVerificationIsDeletedAndTheNextTryWorks`. Android emulator: `scripts/android-e2e/run.mjs` scenarios "tampered bundle rejected: bad hash" and "bad size". |
| **Compromised control plane withholding or delaying updates** | Not stopped. See below. | | **not covered** |
| **Replayed older release** (a real, validly signed old pointer served again) | The device only stages a release number higher than the current, pending and blocked ones. A device that is already on a newer release ignores it. Rolling back is a new, higher release number signed by the publisher (`shipvo rollback`). | `packages/runtime/android/src/main/java/dev/shipvo/runtime/BootRules.kt` (`mayStage`), `ShipvoRuntimeModule.kt` (`release <= known`), `Updater.swift` (`release <= known`) | `packages/runtime/android/src/test/java/dev/shipvo/runtime/StabilityTest.kt` `aReleaseAlreadyPendingCurrentOrBlockedIsNotStagedAgain`. Gap: a device that has not yet reached that release number (a new install, or one that is behind) accepts an older signed pointer. The device does not check `issued_at`. **Not covered** by any test or code. |
| **Wrong-platform bundle** (an Android pointer on iOS, or the reverse) | iOS refuses any pointer whose signed body lacks `platform: "ios"`. iOS pointers live at their own storage key, and the control plane refuses an upload whose body platform does not match its key. Android has no platform check on the device. It relies on the storage key and on the Hermes check below. | `packages/runtime/ios/Updater.swift`, `services/control-plane/src/apps.ts` (`pointerProblem`) | iOS: `RuntimeTests.swift` `testRefusesWhatItCannotTrust` (case `replay`, "not for iOS") and `testNeverReadsTheAndroidPointer`. Control plane: `services/control-plane/test/app.test.ts` "serves iOS pointers from their own key, never the Android one". Android device check and the upload-time platform mismatch refusal: **not covered**. |
| **Hermes-mismatched bundle** | The signed pointer carries `hermes_bytecode_version`. The device compares it with the version in the header of its own embedded bundle and refuses and blocks the release on a mismatch. The control plane filters out releases the shell declared it cannot run, and `shipvo publish` fails before upload. If either side lacks the field, the release is applied (unknown means allowed). | `packages/runtime/android/src/main/java/dev/shipvo/runtime/HermesGuard.kt`, `packages/runtime/ios/HermesGuard.swift`, `packages/cli/src/hermes.ts`, `services/control-plane/src/offer.ts` | `HermesGuardTest.kt` `mismatchIsRefusedWithTypedReason`, `decideCoversMismatchMatchAndMissingField`, `missingFieldIsAccepted`; `RuntimeTests.swift` `testCheckRefusesAReleaseBuiltForAnotherHermesVersion`; `packages/cli/test/hermes.test.ts` "fails when the version is not declared by the shell"; `services/control-plane/test/app.test.ts` "filters releases by the shell's Hermes bytecode versions". |
| **Interrupted download** | Downloads resume into a partial file named by the release hash. A partial file that is too big, corrupt or for another release is discarded. Nothing is staged until size and SHA-256 match. | `packages/runtime/android/src/main/java/dev/shipvo/runtime/ResumableDownload.kt`, `Updater.swift` | `ResumableDownloadTest.kt` `secondRequestStartsAtThePartialSize`, `anOversizedPartialIsDiscarded`, `partialFilesAreNamedByReleaseHash`; `RuntimeTests.swift` `testResumesAnInterruptedDownloadFromThePartialSize`, `testCorruptPartialOfFullSizeIsRejectedThenRefetchedFromZero`, `testPartialForAnotherReleaseIsDeleted`. |
| **A signed release that crashes the app** | Not an attack, but the same blast radius. The device counts trial boots, drops a release that never reports healthy, and reverts one that dies shortly after. | `BootRules.kt`, `Store.swift` | `StabilityTest.kt` `releaseThatDiesAfterMarkHealthyIsReverted`; `RuntimeTests.swift` `testUnhealthyReleaseIsDroppedAfterThreeLoads`, `testReleaseThatDiesAfterMarkHealthyIsReverted`. |
| **Agent with a scoped token** | An agent that holds only the owner token or a publish token cannot sign. It cannot create a release phones accept. The control plane gates its destructive calls behind a server-issued, one-time owner approval (the agent cannot approve its own; `confirm: true` alone does nothing), applies the owner's `agentMaxBand` limit, and the owner can set approval so that a second person must approve a wide release. | `services/control-plane/src/index.ts`, `apps.ts` | `agent-confirm.test.ts` "one-time challenges" (replay, tampered arguments, expiry, denial), `approval-route.test.ts` "the owner token (an agent) cannot approve or deny", "the deny list blocks any command, confirm or not", "agents cannot change the policy; the admin can"; `release-policy.test.ts` "refuses an agent beyond agentMaxBand; a human at the same band succeeds"; `approval.test.ts` "the proposer cannot approve". An agent given the seed has the same power as a stolen seed. |

## What we do not defend against

- **A stolen or leaked seed.** There is no second factor on signing and no key rotation for installed apps. Release policy and approval slow a release down. They do not make a signed release invalid.
- **A malicious publisher or a compromised CI.** Whatever your CI signs is accepted.
- **A downgrade by an attacker who controls the network path or control plane**, for a device that has not yet reached the replayed release number. The device checks the release number only against its own state, not against a signed expiry or a signed "latest".
- **Withholding.** A compromised control plane, CDN or network can serve nothing, or serve a stale pointer. Devices then keep running what they have. There is no signed freshness proof, so a device cannot tell "no update" from "update hidden".
- **Native code changes.** An update is JavaScript on the shell's existing native modules. It cannot add permissions or native modules, but it can use any that the shell already has.
- **A compromised phone or a rooted device.** The staged bundle sits in the app's own storage. We do not defend against code that can already write there.
- **Telemetry integrity.** Reports are signed by an install key registered with the control plane (`services/control-plane/src/installs.ts`). Auto-halt counts only verified reports, one vote per install, and needs failures from at least 3 networks (`halt.ts`, tests in `halt.test.ts`). Registration is rate limited. Revert alerts keep separate slots for verified and unverified reports, so forged rollbacks cannot use up the slots for real ones (`alerts.ts`, `alerts.test.ts` "forged rollbacks do not use up the alert slots for real ones"). Not covered: an anomaly guard, a rate limit on `POST /t`, one stolen install key filling the verified alert slots, and an attacker who registers many installs across 3 or more networks. See [auto-halt.md](auto-halt.md).
- **Denial of service** against the control plane.
- **Android device-side platform check.** See the platform row: not covered.
- **Anything in the hosted simulator or the sample app.** This page is about signed updates only.

## How to check these claims

Every path and test name above can be found with `rg`, for example:

```bash
rg -n "testRefusesWhatItCannotTrust" packages/runtime/ios-tests
rg -n "records nothing for a rejected publish" services/control-plane/test
rg -n "aReleaseAlreadyPendingCurrentOrBlockedIsNotStagedAgain" packages/runtime/android
```

Host-side tests run with `pnpm -r test`. The iOS and Android runtime tests run in CI on a simulator and an emulator.
