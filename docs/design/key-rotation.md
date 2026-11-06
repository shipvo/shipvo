# Design: release key rotation

Status: proposed. Slice 1 of #736 (part of #732). This document changes no behaviour and no code.

## Why

Every installed shell pins one Ed25519 public key (Android manifest meta-data `dev.shipvo.PUBLIC_KEY`, iOS `ShipvoPublicKey` in Info.plist). The runtime accepts a pointer only if its signature verifies against that key. Today that key cannot change. Two things follow:

- If the release seed leaks, we cannot stop the attacker without a new store build.
- If the seed is lost, we cannot ship updates to installed apps at all.

A stolen publish token must also never be enough to take over an app. Today the token can publish releases but cannot sign them, and that stays true.

What was read: `packages/cli/src/signing.ts` (only `keys export` and `keys import`), `signDoc` and `verifyDoc` in `packages/cli/src/index.ts`, `Verify.kt`, `Verify.swift`, `ShipvoRuntimeModule.kt` (pointer check around line 149), `Updater.swift` (around line 50), and both `Store` files.

Prior art: this design draws on general knowledge of TUF (root, targets, version numbers, expiry) and expo-updates code signing (certificate chain). No other project's source or docs were consulted while writing it, and DeepWiki was not used. TUF's idea of an offline root that signs online keys is the model used here.

## 1. Model

Two keys per app.

- **Root key.** Ed25519. Generated on the developer's machine, kept offline (password manager, hardware token or vault). Used only to sign rotation statements. Its public key is pinned in the shell next to the release key.
- **Release key.** The key used today. Signs pointers on every release.

The shell pins `root_public_key` and `release_public_key` (the build-time value, the "genesis" key).

A **rotation statement** is signed by the root key. It names a new release key, when it becomes valid, and a sequence number. The runtime verifies it, stores it, and from then on treats the new key as the current release key.

Key set the runtime trusts at any moment:

1. The current release key: the key from the highest-sequence valid statement, or the pinned genesis key if none is stored.
2. The previous release key, only until `previous_valid_until` (the grace window, below). This lets devices that missed the rotation keep updating while they fetch the statement.

**Old key revoked after a set time.** Each statement carries `old_key_valid_until`. The default is 14 days after `valid_from`, and the CLI refuses a value over 30 days, and the runtime rejects it too (section 4). Both sides check the cap. After that time the runtime rejects pointers signed by the old key. For a leak the owner sets it to `valid_from` (zero grace); the cost is that devices that have not yet fetched the statement stop receiving updates until they do.

**One time rule: the device clock decides.** The runtime reads its own clock, `now`, once per check. It never uses a pointer's `issued_at` for key decisions, because whoever holds the old key can forge it. `now` is the wall clock (`System.currentTimeMillis()` on Android, `Date()` on iOS). Do not use `Store.now()`: it is `SystemClock.elapsedRealtime()` / `ProcessInfo.systemUptime`, which are monotonic and reset on reboot.

- A statement is promoted (becomes the current key) when `now >= valid_from`.
- The previous key is accepted only while `now < previous_valid_until`.

If the device clock is wrong:

- **Clock behind.** Promotion waits longer, and the old key stays accepted past its real deadline. A leaked key keeps working on that device until its clock catches up. Rotation cannot fix this; we say so in the docs.
- **Clock ahead.** Promotion happens early and the old key is rejected early. Pointers signed by the new key are accepted at once. Pointers signed by the old key are rejected, so that device may stop getting updates until its clock is fixed or the owner signs with the new key (which every release does after rotation).

The runtime does not try to detect a bad clock in v1. For leaks the zero-grace setting (section 2) is the defence. Do not claim more.

## 2. Recovery paths

**Leaked release key** (root key safe)
1. `shipvo keys rotate --emergency` creates a new release seed, builds a statement with `valid_from = now` and `old_key_valid_until = valid_from`, and signs it with the root key. The 24-hour default delay in section 3 applies only to planned rotation (`shipvo keys rotate` without the flag). A leak never uses the default delay.
2. The statement is uploaded to the control plane. The control plane serves it from the pointer endpoint (`statement` field next to `body` and `signature`).
3. Devices fetch it on the next update check, verify it against the pinned root key, store it, and from then on accept only the new key.
4. New releases are signed with the new release key. The leaked key can no longer ship updates to any device that has seen the statement.

Honest limit: a device that has not checked in since before rotation still trusts the old key until it sees the statement. An attacker holding the old key and serving that device (network attacker, or a compromised host) can still feed it a pointer. Rotation closes the hole per device, as each device checks in.

**Lost release seed, root key safe.** Same as above; no old key to revoke, so it is a plain rotation.

**Lost or leaked root key.** There is no recovery without a new store build. The shell pins the root key, and nothing short of a new binary can change it. We say so plainly in the CLI output and docs. A leaked root key is worse than a leaked release key: the attacker can rotate every device to a key they hold. This is why the root key stays offline, and why `shipvo keys` warns on `init` that the root seed must be backed up in two places.

A new store build can introduce a fresh root key. Shells with the new root key reject statements from the old one; they are a new trust anchor, not a continuation.

## 3. Abuse: the publish token

Rules:

- The publish token authorises uploads of bundles and pointers. It cannot sign anything. It never touches a seed.
- A statement is valid only if the **root key** signed it. The control plane stores and serves statements but does not decide validity; devices do. A compromised control plane or stolen token can only withhold or replay a statement, never create one.
- The control plane accepts a statement only if it verifies against the app's pinned root key and its sequence is higher than the stored one. This is a convenience check, not a trust decision.

So the publish token alone can never rotate. An attacker needs the root seed.

**M-of-N: not in v1.** Reason: the threat we close is "stolen publish token", and a single offline root key already closes it. M-of-N protects against one stolen root key, but it costs a multi-party signing flow, more shell-pinned keys (a larger and harder-to-change surface) and more ways to lose enough keys to be locked out. Teams with that need can keep the root key in a hardware token or a split-secret vault. The wire format reserves a `signatures` array so M-of-N can be added later without a new format (see section 4).

**Recovery delay: yes, a short one for non-emergency rotations.** The runtime promotes a statement at `valid_from` (section 4, "Between fetch and `valid_from`"), and the CLI sets `valid_from` to now plus 24 hours by default for planned rotation (this is the one place the default is defined; other sections refer here), so an owner watching alerts can notice an unexpected rotation. This does not protect against a stolen root key (the attacker chooses `valid_from`), so the runtime does not enforce a minimum delay. The control plane would notify the owner on every statement upload (proposed; the channel is an open question, see below). That is the only real signal and it is weak. Say so in docs. Emergency rotation (`--emergency`) sets `valid_from` to now.

## 4. Wire format, replay protection, storage

### Statement

JSON, signed over the canonical form already used by `canonicalize` in `@shipvo/schema` (the same path as `signDoc`/`verifyDoc`). The runtime does not re-canonicalise: as with pointers today, the signed bytes are carried as an exact string in an envelope, and the runtime verifies those bytes.

```json
{
  "body": "{\"type\":\"shipvo.key-rotation\",\"v\":1,\"app_id\":\"dev.example.app\",\"sequence\":3,\"new_release_key\":\"<base64 raw 32 bytes>\",\"valid_from\":\"2026-11-07T00:00:00Z\",\"old_key_valid_until\":\"2026-11-21T00:00:00Z\"}",
  "signature": "<base64 Ed25519 over the UTF-8 bytes of body, by the root key>"
}
```

Fields:

| Field | Meaning |
| --- | --- |
| `type`, `v` | Domain separation. A pointer signature can never be read as a statement, and the reverse. Runtime rejects an unknown `type` or `v`. |
| `app_id` | Must equal the shell's app id. Stops a statement for app A being used on app B that shares a root key. |
| `sequence` | Positive integer, strictly increasing per app. Genesis has implicit sequence 0. |
| `new_release_key` | Base64 raw Ed25519 public key. |
| `valid_from` | RFC 3339 UTC. Not applied before this time. |
| `old_key_valid_until` | RFC 3339 UTC, not before `valid_from` and at most 30 days after it. |

A future M-of-N change replaces `signature` with `signatures: [{ key_id, signature }]` and a threshold pinned in the shell. v1 runtimes ignore unknown envelope fields and require `signature`.

### Replay protection

The runtime keeps `key_sequence`, the highest sequence it has applied. It accepts a statement only if `sequence == key_sequence + 1`. Rejecting gaps keeps it simple and stops a withheld-then-replayed older statement from rolling the key back. If a device is several rotations behind, the control plane serves the whole chain in order (`statements: [...]`), and the runtime applies them one by one, each verified against the root key.

**Chain result.** The runtime verifies the whole chain first, then writes the result in one atomic write. Until that write succeeds, the old state applies unchanged. After it:

- The current key is the key from the last statement promoted (`now >= valid_from`).
- The previous key is the key that the last promoted statement replaced, with that statement's `old_key_valid_until` as `previous_valid_until`. Only this one survives.
- Keys from earlier steps in the chain are dropped at once, including the genesis key if two or more rotations were applied. A device two rotations behind gets no grace window for the oldest key.
- At most one statement is pending (below). If a statement in the chain has a future `valid_from`, it becomes the pending statement and any later statement in the chain is not stored; the runtime fetches it again after promotion.

### Between fetch and `valid_from`

A fetched statement that passes checks 1 to 5 is stored as `pending_statement` and `key_sequence` advances at once, so replay protection holds from the moment of fetch. Until the first check with `now >= valid_from`:

- The **current key keeps verifying pointers** (the genesis key, or the last promoted key). The pending key verifies nothing: a pointer signed by it is rejected.
- On the first check with `now >= valid_from`, the runtime promotes in one atomic write: `release_key` = the pending key, `previous_key` = the replaced key, `previous_valid_until` = `old_key_valid_until`, and `pending_statement` is cleared.

An equal or lower sequence is rejected and never changes stored state. A statement for the wrong `app_id` is rejected.

### Order of checks in the runtime

1. Parse the envelope. Reject if malformed.
2. Verify `signature` against the pinned **root** key (`Verify.ed25519`). Reject if invalid.
3. Parse `body`. Check `type`, `v`, `app_id`.
4. Check `sequence == key_sequence + 1`.
5. Check `valid_from` and `old_key_valid_until` shape and the 30-day cap.
6. Store, in one atomic write: `key_sequence` and `pending_statement` (the verified envelope). Do not change `release_key` yet.
7. On every pointer check (and after step 6), if a pending statement exists and `now >= valid_from`, promote it as described above.

Pointer verification then reads the key set from the store instead of reading only the pinned value. The pointer checks themselves do not change.

### Storage

Not secret (public keys and numbers), but it must not be writable by other apps or by a bundle update.

- **Android:** the existing `shipvo.runtime` SharedPreferences file in the app's private storage, written with `commit()` like the other Store values (`Store.kt`). Keys: `key_sequence`, `release_key`, `previous_key`, `previous_valid_until`, `pending_statement`. Private storage is not readable by other apps; root or a backup restore are out of scope. Android backup restore could roll `key_sequence` back; the shell must exclude this file from auto backup (`android:fullBackupContent`) as a build-plan item, or a restore re-opens an old key. Even then, a rolled-back device re-fetches the chain and ends up correct.
- **iOS:** the existing `shipvo.runtime` `UserDefaults` suite (`Store.swift`), same key names. Device backups can restore old values; same mitigation, and the same self-healing by chain fetch.

The pinned genesis keys always remain in the binary. If stored state is corrupt or missing, the runtime falls back to the genesis release key and re-fetches the chain. It never falls back to "no verification".

## 5. Checks that stay unchanged

None of these are edited by the rotation work. Rotation adds code beside them.

`packages/cli/src/signing.ts`
- `valid()` accepts only a 32-byte base64 seed shape.
- `keys export` refuses if the seed's public key does not match `shipvo.json`.
- `keys import` refuses a malformed seed and a seed belonging to a different key than `shipvo.json`.
- Seed file is written with mode `0600`, and the `.gitignore` warning for `.shipvo/` stays.

(Rotation needs a new CLI file for `keys rotate` and `keys root`. It does not edit `signing.ts` checks. If `signing.ts` must be touched, that slice follows the guarded-path contract in `.github/agents/contract.md`.)

`packages/cli/src/index.ts` (signing primitives used by the above): `keyFromSeed` length check (32 bytes), `signDoc`, `verifyDoc` (returns false on any error).

`packages/runtime/android/.../Verify.kt` and `packages/runtime/ios/Verify.swift`
- `ed25519` returns `false` on any decode or crypto error and never throws.
- `ed25519` verifies exactly the bytes passed in.
- `sha256Hex` for files and byte arrays (streamed, 64 KiB chunks).
- `semverLess` for `min_shell_version`.

Callers in `ShipvoRuntimeModule.kt` and `Updater.swift` that stay the same:
- Pointer signature check: `Verify.ed25519(body, signature, key)` must pass or `pointer signature invalid`. Only the `key` argument changes, from the pinned value to "current or still-valid previous key".
- `app_id` and `shell_major` match; `platform == ios` on iOS.
- `release <= known` returns none.
- `min_shell_version` check.
- Patch hash and size, patched bundle hash and size, final bundle hash and size.
- Hermes guard, blocked release, crash-loop rollback.

Rule for the build slices: a diff may add a call to `Verify.ed25519` with a different key. It may not weaken, reorder away or skip any check above.

## 6. Build plan

Each slice stays under 400 changed lines including tests. Slices 3 to 5 touch guarded paths and must pass the merge contract on their exact head commit.

| # | Slice | Files | Est. lines |
| --- | --- | --- | --- |
| 1 | This document. | `docs/design/key-rotation.md`, `changes/736-key-rotation-design.md` | doc |
| 2 | Statement schema and canonical test vectors. Zod/TS type, `type`/`v` constants, a JSON file of vectors (valid, wrong app, wrong type, gap sequence, bad signature) generated once and shared by every platform. | `packages/schema/src/rotation.ts`, `packages/schema/src/index.ts`, `packages/schema/test/rotation.test.ts`, `packages/schema/test/vectors/rotation.json` | ~200 |
| 3 | CLI: `shipvo keys root init` and `shipvo keys rotate` (new seed, build and root-sign the statement, writes it to `.shipvo/rotation/`). Root seed read from file or stdin, never from the publish token. Does not edit `signing.ts` checks. | `packages/cli/src/rotation.ts`, `packages/cli/src/index.ts` (command table only), `packages/cli/test/rotation.test.ts` | ~300 |
| 4 | Control plane: store and serve statements and the chain; accept an upload only if it verifies against the app's root key and sequence increases; reject publish-token-only attempts to change root. Migration is additive. Writes an audit entry for each accepted or rejected statement upload through `audit.ts` (table from `0016_audit_log.sql`, no new audit migration). Must keep `auth.ts` unchanged. | `services/control-plane/src/rotation.ts`, `services/control-plane/src/index.ts` (route), `services/control-plane/migrations/` (new file), `services/control-plane/test/rotation.test.ts` | ~350 |
| 5 | Android runtime: parse and verify statements, key set in `Store`, pointer verification uses the key set, exclude the file from auto backup. | `packages/runtime/android/.../KeyRotation.kt` (new), `Store.kt`, `ShipvoRuntimeModule.kt` (key lookup line), `packages/runtime/android/src/test/.../KeyRotationTest.kt` | ~300 |
| 6 | iOS runtime: same as 5. | `packages/runtime/ios/KeyRotation.swift` (new), `Store.swift`, `Updater.swift` (key lookup line), `packages/runtime/ios/Tests/KeyRotationTests.swift` | ~300 |
| 7 | Build-time config: `ShipvoRootPublicKey` / `dev.shipvo.ROOT_PUBLIC_KEY`, Expo config plugin and `shipvo init` write it. Shells with no root key keep today's behaviour (rotation off). | `packages/cli/src/init.ts` (or the file that writes the plist and manifest), config plugin file, tests | ~200 |
| 8 | Device tests and sample-app scenarios (section "Tests", below), run in CI on the Android emulator and iOS Simulator. | `apps/tide-and-tackle/` rotation fixture, `packages/test` scenario, CI scenario list as allowed by the contract | ~300 |
| 9 | Docs: `docs/key-rotation.md` guide, `docs/cli.md` entries, `docs/self-hosting.md` note. Owner-facing text states the lost-root-key limit. | `docs/*.md`, `changes/` entry | ~250 |

Slice 7 can land before 5 and 6; slices 5 and 6 can run in parallel after 2. Slice 8 needs 3 to 7. Exact file names inside `packages/cli` and `services/control-plane` must be confirmed against the tree when each slice starts; the list above is the intended scope, not a promise of names.

No slice makes rotation mandatory. A shell without a pinned root key behaves exactly as today.

## Tests to run on the Android emulator and the iOS Simulator

Each runs on both platforms, in CI, against a shell built with a known root key and genesis release key. Vectors come from slice 2.

1. **Root-signed accepted.** Serve a statement signed by the root key (sequence 1, new key K1) and then a pointer signed by K1. Expect: statement stored, `key_sequence == 1`, release applied.
2. **Old-key-signed rejected.** After the statement in test 1 with `old_key_valid_until == valid_from`, serve a pointer signed by the genesis key. Expect: `pointer signature invalid`, no release applied, current bundle still boots. Also: with a 14-day grace window, a genesis-signed pointer is accepted while the fake device clock is before `old_key_valid_until` and rejected at or after it. The pointer's `issued_at` is set to a time before the deadline in both cases and does not change the result.
3. **Forged root rejected.** Serve a statement signed by a key that is not the pinned root (including a statement signed by the release key itself). Expect: rejected, `key_sequence` unchanged, genesis key still the one used.
4. **Replayed statement rejected.** Apply sequence 1, then 2. Replay sequence 1, and replay sequence 2. Expect both rejected, key unchanged. Also a gap (sequence 4 when stored is 2) is rejected.

5. **Fetched, not yet valid.** Fetch a statement at T with `valid_from = T+24h`. Expect `key_sequence` advanced and `pending_statement` stored. At T+1h a pointer signed by the new key is rejected with `pointer signature invalid`, and a pointer signed by the current key is accepted. At T+24h the next check promotes the statement and the new key is accepted.
6. **Cap.** A statement with `old_key_valid_until` more than 30 days after `valid_from` is rejected, state unchanged.
7. **Chain.** Device at genesis, chain of two statements. Expect the second key current, the first key as previous with the second statement's `old_key_valid_until`, and a genesis-signed pointer rejected.
8. **Clock.** Device clock behind `valid_from` keeps the old key; clock ahead of `old_key_valid_until` rejects the old key. Also: relaunch the app (process restart) between fetch and `valid_from` and check the decision still follows the wall clock, not uptime.

Extra cases in the same run: wrong `app_id`; wrong `type`; corrupted stored state falls back to the genesis key; relaunch keeps the rotated key.

Record what CI measured and on what image. Do not report results from other devices.

## Open questions

- The `statements` chain a device will verify is capped at 16 (slices 5 and 6 use this number), so a hostile server cannot make a device verify an unbounded chain. Whether 16 is the right number is open. A device further behind than the cap would need a new store build. The number is not chosen.
- Should the control plane send the owner a message on every statement upload? Proposed yes; delivery channel is not chosen.
- Do we offer `keys root` as a separate offline command that never needs a network? Proposed yes, so a root seed never has to touch a machine with a publish token.
