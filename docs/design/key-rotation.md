# Signing key rotation: model and wire format

Prior art, learned through DeepWiki (ideas only, no code copied): `expo/expo` (expo-updates code signing signs the exact manifest body, and the verifying certificate is embedded in the build) and `theupdateframework/specification` (TUF: metadata versions only go up, clients store the latest trusted version and reject a lower one, and a new root is signed by the old root).

Status: design only (slice 1a of #736, part of #732). No code changes. Slice 1b covers what is listed under "Left for slice 1b".

## 1. Model

Today every installed shell pins one public key, and only the matching seed can update it. If that seed leaks, the only fix is a new store build.

The shell will pin two public keys:

- **Root key.** Ed25519. Kept offline and used rarely. It only signs rotation statements. It never signs releases.
- **Release key.** Ed25519. The key `shipvo publish` signs with. It is the key pinned today.

The shell trusts the pinned root key and one *current release key*. The current release key starts as the pinned release key. A rotation statement, signed by the root key, replaces it with a new one.

A statement can only name a new release key. It cannot change the root key. A publish token cannot make a statement, because the root signature is checked by every phone.

## 2. Recovery paths

| Situation | Fix |
| --- | --- |
| Release key leaked | Rotate with the root key. Phones switch when they fetch the statement. Until then they still trust the leaked key. |
| Release key lost | Rotate with the root key. |
| Root key lost | New store build with a new root key. This cannot be fixed over the air. |
| Root key leaked | Same as lost: new store build. The attacker can rotate until phones update. |

If you lose the root key, you must ship a new store build. We say so plainly because no over-the-air fix can exist: the shell trusts nothing else.

## 3. Wire format and replay protection

A statement is an envelope, the same shape as the pointer envelope that phones verify today:

```json
{
  "body": "{\"type\":\"key-rotation\",\"appId\":\"tide\",\"sequence\":1,\"newKey\":\"<base64>\",\"validFrom\":\"2026-11-06T00:00:00.000Z\"}",
  "signature": "<base64 Ed25519 signature by the root key>"
}
```

`body` is a string holding JSON. The signature is Ed25519 by the root key over the exact bytes of that string (UTF-8), base64 encoded. The runtime verifies the signature first, with `Verify.ed25519` (`Verify.kt`, `Verify.swift`), and only then parses `body`. This is how `ShipvoRuntimeModule.kt` and `Updater.swift` check pointers. Native code needs no `canonicalize`, so a signature cannot verify on one platform and fail on the other because of key order or whitespace. The signer keeps the exact string it signed.

Delivery: this slice does not fix how a phone obtains the envelope (endpoint, upload, offline root signing). Whatever carries it is not trusted. Only the root signature makes a statement valid. This is listed under "Left for slice 1b".

The body has these fields:

Fields:

- `type`: the literal `key-rotation`. Anything else is rejected.
- `appId`: must equal the shell's app id.
- `sequence`: integer, at least 1. The first statement is 1.
- `newKey`: 32-byte Ed25519 public key, base64.
- `validFrom`: ISO 8601 UTC time. It records when the root key holder signed the statement. It is for audit and for the clock-skew check below. It is never used for expiry, and a statement does not become invalid with age.

The runtime accepts a statement only if all of these hold:

1. The signature over `body` verifies against the pinned root key. A statement signed by a release key or any other key is rejected.
2. `type` and `appId` match.
3. `sequence` is higher than the effective sequence: the larger of the stored sequence (0 if none) and the build's minimum sequence (section 4). A statement with a sequence number not higher than the stored one is rejected. This stops replay of old statements.
4. `validFrom` is not more than 24 hours in the future. This only rejects statements with a wildly wrong time. It is not a delay: the statement takes effect at once when accepted.
5. `newKey` decodes to 32 bytes.

One statement is accepted at a time in this slice. On accept the runtime writes the new key and the new sequence together, then uses the new key for the next check. The old key is rejected from then on. There is no overlap period.

Sequence numbers only go up. The statement does not carry the previous key, so a runtime that missed statement 1 can still accept statement 2. A phone that has stored 1 and sees sequence 3 accepts it and skips 2. The cost: a phone that missed a statement moves straight to the newest key.

## 4. Where the runtime stores the key and sequence

The runtime already keeps its state in `packages/runtime/android/src/main/java/dev/shipvo/runtime/Store.kt` and `packages/runtime/ios/Store.swift`.

- **Android:** `SharedPreferences` file `shipvo.runtime`, private mode (the same file `Store.kt` uses). New keys: `rotation.releaseKey`, `rotation.sequence`, `rotation.pinnedKey`. The pinned values come from the manifest meta-data `dev.shipvo.PUBLIC_KEY` (exists today) and new `dev.shipvo.ROOT_KEY` and `dev.shipvo.MIN_SEQUENCE`.
- **iOS:** `UserDefaults` suite `shipvo.runtime` (the same suite `Store.swift` uses). The same three keys. The pinned values come from the Info.plist entry `ShipvoPublicKey` (exists today) and new `ShipvoRootKey` and `ShipvoMinSequence`.

Rules for both:

- Write the key and the sequence in one atomic step (one `SharedPreferences.Editor.commit()`, one `UserDefaults` write of a single dictionary value).
- **Minimum sequence.** Each store build pins `MIN_SEQUENCE`: the highest statement sequence that exists when the build is made (0 if none). The effective sequence is `max(stored sequence, MIN_SEQUENCE)`. A build must never pin a release key unless `MIN_SEQUENCE` is at least the sequence of the statement that named that key.
- **Sequence survives pin changes.** `rotation.pinnedKey` records the release key pinned by the shell that wrote the state. If a new store build pins a different release key, the stored release key is discarded and the new pin is used, but the stored sequence is kept. It is never lowered.
- **Why.** Take release key K1 that leaks, and a root rotation to K2 as statement 1. A later store build pins K2 with `MIN_SEQUENCE` 1. Replaying statement 1 (which names K1) fails: 1 is not higher than 1. Only a statement 2 or later, signed by the root key, can change the key again. No old statement can restore a key the shell no longer pins.
- If the stored values are missing or unreadable, the runtime falls back to the pinned release key. It never falls back to "no check".
- Clearing app data or reinstalling drops the stored key and sequence. The phone returns to the pinned release key, and the effective sequence falls back to the build's `MIN_SEQUENCE`. A replay of any statement at or below `MIN_SEQUENCE` still fails. Statements above it are accepted, which is correct: they are newer than the build.

The names of the storage keys and the new manifest and plist entries are proposals. Slice 1b fixes them in the build plan.

## 5. Checks that stay unchanged

Rotation does not change any of these. They run exactly as today, with the *current release key* in place of the pinned one.

In `packages/cli/src/signing.ts` (`shipvo keys export` and `shipvo keys import`):

- `keys export` refuses a seed whose public key does not match `publicKey` in `shipvo.json`.
- `keys import` refuses input that is not a 32-byte base64 seed.
- `keys import` refuses a seed whose public key does not match `publicKey` in `shipvo.json`.
- The seed file is written with mode `0600`.

In `packages/runtime/android/src/main/java/dev/shipvo/runtime/Verify.kt` and `packages/runtime/ios/Verify.swift`:

- `ed25519` returns false on any decoding error or bad signature. It never throws past the caller.
- `sha256Hex` (file and bytes) is unchanged.
- `semverLess` is unchanged.

In the callers (`ShipvoRuntimeModule.kt`, `packages/runtime/ios/Updater.swift`), the pointer checks stay in the same order:

- The pointer envelope signature must verify before the body is read.
- The app id and shell major must match.
- A release number not above the known one is ignored.
- `min_shell_version` must not be above the shell version.
- Patch size and SHA-256, and the patched bundle size and SHA-256, must match.

The only change in the callers is the key passed to `ed25519` for the pointer envelope. That change is slice 1b's build plan, not this document.

## Left for slice 1b

- How a phone obtains a statement: endpoint, who uploads it, and how the root key signs offline without a publish token
- Pending statements
- Emergency rotation
- Abuse by a stolen publish token
- Tests and slice plan
