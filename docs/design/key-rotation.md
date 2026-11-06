# Signing key rotation: model and wire format

Prior art, learned through DeepWiki (ideas only, no code copied): `expo/expo` (expo-updates code signing signs the exact manifest body, and the verifying certificate is embedded in the build) and `theupdateframework/specification` (TUF: metadata versions only go up, clients store the latest trusted version and reject a lower one, and a new root is signed by the old root).

Status: design only (slices 1a and 1b of #736, part of #732). No code changes. Sections 6 to 11 are slice 1b: delivery, pending statements, the chain cap, time, abuse, tests and the build plan.

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

Delivery is in section 6. Whatever carries the envelope is not trusted. Only the root signature makes a statement valid.

The body has these fields:

- `type`: the literal `key-rotation`. Anything else is rejected.
- `appId`: must equal the shell's app id.
- `sequence`: integer, at least 1. The first statement is 1.
- `newKey`: 32-byte Ed25519 public key, base64.
- `validFrom`: ISO 8601 UTC time. The statement takes effect when the runtime's clock reaches it (section 7). It is never used for expiry: a statement does not become invalid with age. For an emergency rotation the signer sets it to the signing time or earlier.

The runtime accepts a statement only if all of these hold:

1. The signature over `body` verifies against the pinned root key. A statement signed by a release key or any other key is rejected.
2. `type` and `appId` match.
3. `sequence` is higher than the effective sequence: the larger of the stored sequence (0 if none) and the build's minimum sequence (section 4). A statement with a sequence number not higher than the stored one is rejected. This stops replay of old statements.
4. `validFrom` is not more than 90 days after the runtime's current time. This bounds how long a statement can stay pending.
5. `newKey` decodes to 32 bytes.

A statement that passes these checks is either applied or kept pending, by the rules in section 7. When a statement is applied the runtime writes the new key and the new sequence together, then uses the new key for the next check. The old key is rejected from then on. There is no overlap period.

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

The names of the storage keys and the new manifest and plist entries are fixed by this design, plus one more storage key, `rotation.pending` (section 7). Slice 2 and slice 3 in section 11 create them.

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

The only change in the callers is the key passed to `ed25519` for the pointer envelope. That change is in the build plan in section 11, not in this document.

## 6. Delivery

- **Signing.** The root key holder signs offline with `shipvo keys rotate sign` (slice 4). The command reads the root seed from a file the holder gives it, never from the control plane, and prints the envelope.
- **Upload.** `shipvo keys rotate upload` sends the envelope to `POST /rotation/<app>` on the control plane. The route needs the *owner* token. A publish token gets 403. The control plane checks the root signature and the same field rules as section 3 using the root key registered for the app, then stores the envelope. It is a courier only: phones verify again and never trust the control plane's check.
- **Fetch.** The pointer response gains a `rotations` array of envelopes, oldest sequence first, with at most 8 entries (the cap in section 8). The runtime handles `rotations` before it looks at the pointer, so a release signed by a new key can arrive in the same fetch.
- **Owner token.** The owner token is a different secret from the publish token and is not stored in CI. If your setup puts both in one place, the abuse analysis in section 10 does not hold for you.

## 7. Pending statements and emergency rotation

The runtime keeps one ordered list of pending statements in `rotation.pending`, sorted by `sequence`. A statement is pending when it is valid but its `validFrom` is later than the clock.

One rule, run on every fetch and on every launch:

1. Check each delivered statement by the order in section 8, then drop any whose `sequence` is not above the effective sequence.
2. Among all known statements (delivered and already pending) whose `validFrom` is at or before the clock, pick the one with the **highest sequence**. Apply it: write its key and sequence, and delete every statement in the pending list with a lower or equal sequence. A statement that is applied is never replaced by a lower one.
3. Keep the rest, which have a later `validFrom` and a higher sequence than the applied one, in the pending list. At most 8 are kept. If more than 8 remain, the lowest sequences are kept and the rest are dropped. Dropped statements can be delivered again.
4. Two different statements with the same `sequence`: the first one the runtime accepted stays, and the other is rejected. The same bytes delivered twice are a no-op.

What this means:

- **A second statement while one is pending.** Both are kept in sequence order. Each applies when the clock reaches its `validFrom`, lowest sequence first, unless a higher one is already due (then step 2 skips the lower).
- **Emergency after planned.** Planned statement 1 has `validFrom` in 7 days. The root key holder then signs statement 2 with `validFrom` set to now. Statement 2 is due, has the higher sequence, and applies at once. Statement 1 is dropped, and never applies. This works even when statement 2's `validFrom` is earlier than statement 1's. The emergency statement must always have a higher sequence than every statement it should override. The signer tool picks the next free sequence and refuses to sign an emergency statement with a lower one.
- **Planned after emergency.** Statement 2 applied, statement 1 arrives late: its sequence is not above 2, so it is rejected.
- **Relaunch.** `rotation.pending` is written in the same atomic write as the key and sequence. On launch the runtime reads it, checks the clock, and applies due statements before it checks any pointer. A corrupt `rotation.pending` is cleared and the key and sequence are kept.

## 8. Chain cap and order of checks

The cap is **8** statements. It applies to one delivery (the `rotations` array) and to the stored pending list. Sequences may skip, so a phone never needs a long chain: only the newest due statement matters.

The runtime checks in this order, and stops at the first failure:

1. The `rotations` array has at most 8 entries. A longer array is rejected whole **before any signature is verified**, so a long list of junk costs one length check.
2. The envelope's `body` and `signature` are strings and `body` is at most 1 KB.
3. The signature over `body` verifies against the pinned root key.
4. Then the parse and the field rules in section 3.

Slice plan and tests below use the same number.

## 9. Time rule

The runtime takes the time from an injectable clock, `Clock.now()`, with one implementation that reads the wall clock and one that tests set. Android and iOS both have it (slices 2 and 3). No rotation code reads the system time directly. Emulator and simulator tests set the clock and move it forward, so no test sleeps.

The wall clock can be wrong, or changed by the user. The effect is limited, because statements are root-signed:

- A clock set forward applies a pending statement early. The statement is still one the root key holder signed.
- A clock set backward only delays a pending statement. It never undoes an applied one, because sequences go up.
- A clock far in the past makes check 4 in section 3 pass for a statement that is far in the future. This is accepted.

## 10. Abuse

**A publish token alone can never rotate.** The runtime requires a root signature, the root key is not on the control plane or in CI, and the upload route needs the owner token (section 6). A thief with the publish token can ship a release signed only if they also have the release seed.

**M-of-N is not in v1.** One offline root key already blocks the main threat, a stolen CI token. M-of-N would need a new wire format and a signing ceremony, and it does not help a team of one. The format has room for it later (a `signatures` list), which would be a new `type` and a migration note.

**A recovery delay is not in v1 for emergency rotation.** The delay would be the time an attacker with a leaked release key stays trusted, and we want that as short as possible. A *planned* rotation already has a delay: the signer picks `validFrom`. Anyone who steals the root key can rotate at once, which is why a leaked root key needs a new store build (section 2).

**Owner notification is not shipped in v1.** There is no email or webhook when a statement is uploaded. The record is an audit log entry (`key-rotation`, with sequence and `validFrom`) that `shipvo audit <app>` already prints. Owners must look.

Other limits we state plainly:

- Someone who controls the network can withhold a statement. The phone then keeps trusting the old key. There is no freshness proof in v1.
- A leaked release key stays trusted on a phone until that phone fetches the statement.
- Replay is stopped by the sequence rule in section 3.

## 11. Tests and build plan

### Tests

Run on the Android emulator and the iOS Simulator in CI, with the test clock from section 9. Each test starts from a fresh install that pins root key R, release key K1, `MIN_SEQUENCE` 0. A test passes only if it passes on both.

| # | Test | Expected |
| --- | --- | --- |
| 1 | Statement 1 signed by R, naming K2 | Applied. A pointer signed by K2 is accepted, one signed by K1 is rejected. |
| 2 | Statement signed by K1 (the old release key) | Rejected. K1 stays current. |
| 3 | Statement signed by a different, forged root key | Rejected. Nothing stored. |
| 4 | Statement 1 applied, then the same envelope again | Rejected (sequence not above 1). Key and sequence unchanged. |
| 5 | Statement 1 (`validFrom` in 7 days) pending, then statement 2 (`validFrom` in 14 days) | Both in `rotation.pending` in order. At day 7 key K2 applies, at day 14 key K3 applies. |
| 6 | Statement 1 (`validFrom` in 7 days) pending, then statement 2 (`validFrom` now, naming K3) | K3 applies at once. Statement 1 is dropped. At day 7, nothing changes. |
| 7 | A `rotations` array with 9 entries (the last valid, the rest invalid) | Rejected whole. The test counts signature verifications and expects 0. An 8-entry array with a valid last entry is accepted. |
| 8 | Statement pending, app killed and relaunched, clock moved past `validFrom` | Pending list survives. The statement applies on launch before the first pointer check. |

Also in the Android and iOS unit suites: same sequence with different bytes (rule 4 in section 7), a corrupt `rotation.pending`, and `validFrom` more than 90 days ahead.

### Slices

Each is under 400 changed lines. Slice 1 is this document.

| Slice | What | Files it touches |
| --- | --- | --- |
| 2 | Android: `Clock`, `Rotation.kt` (checks, pending list, apply), storage in `Store.kt`, manifest entries, wired into the pointer check, instrumented tests 1 to 8 | `packages/runtime/android/src/main/java/dev/shipvo/runtime/Rotation.kt`, `Store.kt`, `ShipvoRuntimeModule.kt`, `AndroidManifest.xml`, `packages/runtime/android/src/androidTest/` |
| 3 | iOS: the same, with the same test vectors | `packages/runtime/ios/Rotation.swift`, `Store.swift`, `Updater.swift`, `packages/runtime/ios/Tests/` |
| 4 | CLI: `shipvo keys rotate sign` and `upload`, a shared vector file for slices 2 and 3 | `packages/cli/src/signing.ts` (new commands only, no change to the existing checks in section 5), `packages/cli/src/rotation.ts`, `packages/cli/test/rotation.test.ts` |
| 5 | Control plane: `POST /rotation/<app>` (owner token only), storage, `rotations` in the pointer response, audit entry | `services/control-plane/src/rotation.ts`, `index.ts`, `audit.ts` (add `key-rotation` to the `action` type), `services/control-plane/test/rotation.test.ts` |
| 6 | Audit view and docs: a `shipvo audit` test that a `key-rotation` row prints in JSON and CSV, and the user guide | `packages/cli/test/audit.test.ts`, `docs/cli.md`, `docs/threat-model.md` |

The CLI `packages/cli/src/audit.ts` needs no code change: it prints whatever rows the control plane returns. Slice 6 adds the test that proves it.

**Migration needed.** `services/control-plane/migrations/0016_audit_log.sql` has `CHECK (action IN ('publish','rollback','halt'))`, so a `key-rotation` row is refused until a new migration widens it. Agents may not write migrations. Slice 5 therefore waits for a human-written migration, and its issue must say so. Until then the upload route can still work, because `recordAudit` never throws, but it would write no audit row. Slice 5 must not ship without the row.

Slices 2 and 3 change guarded code. Both must pass the merge contract (`.github/agents/contract.md`) on their head commit. Slice 4 changes guarded signing code and the same applies.
