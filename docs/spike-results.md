# Spike results

Real-device numbers only. Nothing here is simulated. Raw rows come from the control plane's `telemetry` table (D1).

## Device

| | |
| --- | --- |
| Phone | Xiaomi Redmi 9A (MediaTek Helio G25, 2 GB-class RAM) |
| OS | Android 11 (API 30), MIUI, force-dark enabled by the system |
| Network | 4G / Wi-Fi, Douala, Cameroon |
| Shell | `tide-and-tackle-shell.apk` 1.0.0 (build `shell-1.0.0-3`), Expo SDK 58, React Native 0.88, Hermes |
| Control plane | Cloudflare Workers + KV + D1 on `workers.dev` |

## Results so far (30 Oct 2026)

| Bar | Target | Measured | Status |
| --- | --- | --- | --- |
| Publish to applied | under 60 s | **36 s** (release 1), **16 s** (release 2), from signed pointer to the new release running and healthy | Pass |
| Push to applied (including CI build and signing) | not a bar | about 69 s for release 1 | Info |
| Signature and hash verified on device | required | Ed25519 over the pointer, SHA-256 and size over the bundle, against a public key built into the APK | Pass |
| Apply without restart | not a bar | **302 ms**, 279 ms, 240 ms (in-process reload) | Info |
| Bundle download | not a bar | 1.57 MB in 1.4 to 2.0 s | Info |
| Rollback on device | works | Rolled back to release 1, then re-applied release 2 from the server within about 10 s | Pass, with a gap (below) |
| Update size | under 100 KB | **1.57 MB** (full Hermes bundle) | **Fail**: needs bundle diffs |
| Cold start | under 1 s on low-end Android | 1,051 ms on first launch after install; repeat cold starts pending | Pending |
| Crash-loop revert | automatic after 3 failed boots | Built, not yet tested on device | Pending |

## Timeline: release 1

| Event | UTC |
| --- | --- |
| `git push` | 06:35:42 |
| Pointer signed and published (CI) | 06:36:15.4 |
| Phone downloaded, verified, staged | 06:36:50.1 |
| Release 1 running and marked healthy | 06:36:51.1 |

## Timeline: release 2

| Event | UTC |
| --- | --- |
| Pointer signed and published (CI) | 06:39:24.7 |
| Phone downloaded, verified, staged | 06:39:39.1 |
| Release 2 running and marked healthy | 06:39:41.1 |

## Gaps found and next actions

1. **Update size:** ship bsdiff patches against the last good bundle, with full download as fallback. Target under 100 KB for typical changes.
2. **Device rollback is undone by the next check:** a local rollback must block that release on the device until a newer one is published. Fleet rollback belongs on the server (re-point bands to the previous release); add `purenative rollback`.
3. **Reload vs cold-start detection is a heuristic in JS:** rollback reloads were sometimes reported as cold starts. Move the distinction into the native module, which knows whether the process was just created.
4. **MIUI force-dark repaints the app:** declare dark-mode support in the shell theme and ship dark tokens.
5. **Polling every 10 s while open** is a spike setting. Production uses check-on-foreground plus an optional push nudge.
