# Signing key rotation for installed apps

Status: design plus first slice (statement format, CLI). Part of #732, issue #736.

## Problem

Every installed shell pins one public key. If the release seed leaks or is lost, today the only fix is a new store build. A stolen publish token must never be able to change which key phones trust.

## Model

Two keys:

- **Root key.** Ed25519. Kept offline (password manager, hardware vault). Used only to sign rotation statements. Its public half is built into the shell next to the release key (`rootKey` in `shipvo.json`).
- **Release key.** The key `shipvo publish` signs releases with. It is the key pinned today. Used on every release.

The shell trusts: the pinned root key, and a *current release key* (starts as the pinned one).

## Rotation statement

```json
{
  "type": "key-rotation",
  "appId": "tide",
  "sequence": 1,
  "previousKey": "<base64 release key being replaced>",
  "newKey": "<base64 new release key>",
  "validFrom": "2026-11-06T00:00:00.000Z",
  "revokeOldAfter": "2026-12-06T00:00:00.000Z",
  "signature": "<base64 Ed25519 by the root key over the canonical JSON>"
}
```

The runtime accepts a statement only if all of these hold:

1. The signature verifies against the **pinned root key**. A statement signed by any release key, or by another root, is rejected.
2. `appId` matches the shell.
3. `sequence` is greater than the highest sequence the runtime has stored. Replaying an old statement is rejected.
4. `previousKey` equals the current release key.
5. `validFrom` is not in the future by more than the clock-skew allowance.

On accept the runtime stores the statement (sequence, new key, revoke time). Then:

- Releases signed by `newKey` are accepted from `validFrom`.
- Releases signed by the old key are accepted until `revokeOldAfter`, then rejected. `revokeOldAfter: null` means revoke at once (use this when the old key leaked).
- All existing checks stay: Ed25519 signature, SHA-256 hash, size. A statement can only name a new release key. It cannot change the root key.

## Delivery

The control plane stores statements per app and serves them with the update manifest. Publishing a statement needs a statement the root key signed, so the publish token alone cannot rotate: the server and every phone check the root signature. The control plane writes an audit entry for each stored statement. The server is not trusted: phones verify everything themselves.

## Recovery

| Situation | Fix |
| --- | --- |
| Release seed leaked | Rotate with the root key, `revokeOldAfter: null`. Phones that have not fetched the statement yet still trust the leaked key until they do. |
| Release seed lost | Rotate with the root key. |
| Root key leaked | Not recoverable over the air: the attacker can rotate. Ship a new store build with a new root. |
| Root key lost | New store build. We cannot fix this over the air, by design. |
| Publish token stolen | Revoke the token. It cannot rotate. |

Optional hardening, not in this slice: M-of-N root signatures, and a delay (a statement takes effect after N days, so owners can notice a surprise rotation).

## Plan

1. This slice: this document, `packages/cli/src/rotation.ts` (build and check statements, strict sequence), `shipvo keys root`, `shipvo keys rotate`.
2. Control plane: store and serve statements, audit entries.
3. Runtime `Verify.kt` / `Verify.swift`: keep every existing check, add the rotation path. Contract tests, then emulator and Simulator tests: accepted when root-signed; rejected when signed by the old release key or a forged root; replay rejected.

## Commands

- `shipvo keys root [--out file]` makes a root key. Prints the public half. Put it in `shipvo.json` as `rootKey` before the next store build.
- `shipvo keys rotate --root-seed-file <file> [--revoke-after <days>|now]` makes a new release seed in `.shipvo/seed.next.txt` and a signed statement in `.shipvo/rotations/<sequence>.json`.

Prior art read: expo-updates code signing (certificate chains with an expiry) and TUF (root, threshold keys, version numbers that only go up).

## Notes for owners

- `.shipvo/` holds `seed.next.txt`, a secret. Keep it out of git (add `.shipvo/` to `.gitignore`).
- `keys rotate` refuses to run while `.shipvo/seed.next.txt` exists, so the seed for the key an earlier statement names is never lost. Publish with that seed, then move the file away and rotate again.
- After a rotation, set `publicKey` in `shipvo.json` to the newest `newKey` once you publish with the new seed. The next `keys rotate` takes `previousKey` from the last statement in `.shipvo/rotations`, not from `publicKey`, so keep the two in step.
- `keys root` without `--out` prints the root seed to stdout and warns. Prefer `--out <file>`.
