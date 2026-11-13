# Release format v1

This page defines the signed release pointer that Shipvo runtimes on Android and iOS fetch and verify. It is written from `packages/schema/src/index.ts` (`ReleasePointer`, `SignedEnvelope`, `canonicalize`) and the runtime verify code in `packages/runtime`. A test in `packages/schema/test/release-format-doc.test.ts` checks that every field named here exists in the schema.

## Envelope

A pointer travels as a `SignedEnvelope` JSON object:

| Field | Meaning |
| --- | --- |
| `body` | The exact JSON string that was signed. |
| `signature` | Ed25519 signature over the UTF-8 bytes of `body`, in base64. |
| `key_id` | Optional. Names the signing key. |

## Signing input

The signing input is the UTF-8 bytes of the `body` string, exactly as sent. A device verifies those bytes first and parses them after, so it does not need to canonicalise JSON. Signers that build `body` from an object use `canonicalize`: keys sorted at every level, no whitespace, and the `signature` field left out.

## Pointer body fields

`schema_version` is `"1.0"`. Fields marked optional may be absent.

| Field | Type | Notes |
| --- | --- | --- |
| `schema_version` | `"1.0"` | Required. |
| `app_id` | string | Required. |
| `shell_major` | integer | Required. Releases only reach shells with this major. |
| `band` | `b0`, `b1` or `b2` | Required. Rollout band: cohort 0–9, 10–99, 100–999. Lower bands see a release first. |
| `platform` | `"ios"` | Optional. Absent means Android. |
| `kind` | `"web"` | Optional. Absent means a React Native JS bundle. |
| `release` | positive integer | Required. |
| `issued_at` | ISO 8601 date-time | Required. |
| `core` | object | Required. `version`, `sha256`, `size`, `url`, and optional `patches`. |
| `addons` | array | Each entry: `id`, `version`, `sha256`, `size`, `url`, optional `diff_from`. Default empty. |
| `screens` | array | Each entry: `id`, `sha256`, `size`, `url`. Default empty. |
| `min_shell_version` | semver | Required. |
| `hermes_bytecode_version` | positive integer | Optional. |
| `hermes_engine` | string | Optional. |
| `required_native_modules` | map of name to semver range | Optional. |
| `web` | object | Optional. `base`, `entry`, `sha256`, `files`. |
| `state_version` | positive integer | Optional. Version of the stored-data format the release reads and writes. |
| `new_control_plane` | object | Optional. `base_url`, `cdn_url`. |
| `signature` | base64 | In the wire form of the pointer; not part of the signed body. |

`core.patches` entries have `from_sha256`, `url`, `size` and `sha256`. Patches are BSDIFF40.

## Platform binding

`platform` is inside the signed body. An iOS pointer says `"ios"`. An Android pointer leaves it out. Because the signature covers it, a pointer signed for one platform cannot be replayed to the other: the Android runtime rejects a pointer with `platform` set to `"ios"`, and the iOS runtime rejects one without it.

## Verification order

A runtime checks, in this order:

1. Apply any key rotation statements in the envelope, so a release signed by a new key can arrive in the same fetch.
2. Check the Ed25519 signature over the `body` bytes with the current release key.
3. Parse `body`.
4. Check `platform` matches the runtime's platform.
5. Check `app_id` and `shell_major` match the installed shell.
6. Skip the pointer if `release` is not newer than the newest release the device already knows.
7. Check the shell version is at least `min_shell_version`.
8. Check `hermes_bytecode_version` against the shell's Hermes bytecode version.
9. Download `core` (a patch from `core.patches` when one matches, otherwise the full file) and check its `size` and `sha256`.

A release is staged only after every step passes.

## Failure reasons

Runtime errors, as raised by the verify path:

| Reason | Step |
| --- | --- |
| `pointer signature invalid` | 2 |
| `pointer is not for Android` | 4 (Android) |
| `pointer is not for iOS` | 4 (iOS) |
| `pointer for another app/shell` | 5 |
| `shell too old for release` | 7 |
| `bundle hash/size mismatch` | 9. Also queues the `verify_failed` event. |

Typed reasons for a release the shell cannot run. The control plane answers with `404` and one of these in the body, and the runtime returns `status: none` with the reason and keeps the current release:

- `hermes_bytecode_mismatch`
- `native_module_missing`
- `native_module_version`

The runtime also reports `hermes_bytecode_mismatch` itself (step 8) and blocks that release.

## Related

- [Key rotation](/docs/key-rotation/)
