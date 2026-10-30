# Spike results

Real-device numbers only. Nothing here is simulated. Raw rows come from the control plane's `telemetry` table (D1).

## Device

| | |
| --- | --- |
| Phone | Xiaomi Redmi 9A (MediaTek Helio G25, 2 GB-class RAM) |
| OS | Android 11 (API 30), MIUI, force-dark enabled by the system |
| Network | 4G / Wi-Fi, Douala, Cameroon |
| Shell | `tide-and-tackle-shell.apk` 1.0.0 (`shell-1.0.0-3`), 1.0.1 (`shell-1.0.1-6`), then 1.0.2 with bsdiff patches (`shell-1.0.2-7`); Expo SDK 58, React Native 0.88, Hermes |
| Control plane | Cloudflare Workers + KV + D1 on `workers.dev` |

## Results so far (30 Oct 2026)

| Bar | Target | Measured | Status |
| --- | --- | --- | --- |
| Publish to applied | under 60 s | **36 s** (release 1), **16 s** (release 2), from signed pointer to the new release running and healthy | Pass |
| Push to applied (including CI build and signing) | not a bar | about 69 s for release 1 | Info |
| Signature and hash verified on device | required | Ed25519 over the pointer, SHA-256 and size over the bundle, against a public key built into the APK | Pass |
| Apply without restart | not a bar | **302 ms**, 279 ms, 240 ms (in-process reload) | Info |
| Bundle download | not a bar | 1.57 MB in 1.4 to 2.0 s | Info |
| Rollback on device | works | Rolled back to release 1, then re-applied release 2 from the server within about 10 s on shell 1.0.0; fixed in 1.0.1 by blocking rolled-back releases | Pass |
| Update size | under 100 KB | **64 KB** patch for release 7 (from release 6, content change), against a 1.57 MB full bundle (96% smaller). Downloaded, patched and verified in 913 ms. First update after a fresh install, patched against the APK's own bundle: 291 KB. Bench tests: 17 to 112 KB between releases | Pass (steady state); first update after install is 291 KB |
| Cold start | under 1 s on low-end Android | **877, 905, 878 ms** running an OTA bundle (shell 1.0.0); **931 ms** first launch on shell 1.0.1; **847 ms** right after a crash-loop revert. First launch after a fresh install: 1,051 ms | Pass |
| Crash-loop revert | automatic after 3 failed boots | Release 4 crashed at startup on purpose; after 3 failed boots the phone discarded it, blocked it, and came back on release 3 by itself (07:11:35 UTC). It did not download release 4 again | Pass |
| Shell-upgrade safety | OTA bundles from an older shell never run on a newer one | Installing shell 1.0.1 discarded release 2 and booted the embedded bundle; release 3 (min shell 1.0.1) was refused by shell 1.0.0 and accepted by 1.0.1 | Pass |

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

## Timeline: crash-loop test (release 4)

| Event | UTC |
| --- | --- |
| Release 4 (throws at startup) published | 07:08:47 |
| Downloaded, verified, applied, crashed (boot 1) | 07:10:22 |
| Boots 2 and 3 crashed (owner reopened the app) | before 07:11:35 |
| `crash_loop_revert`: release 4 discarded and blocked | 07:11:35 |
| Running release 3 again, cold start 847 ms | 07:11:37 |

## Timeline: patch updates (shell 1.0.2, fresh install)

| Event | UTC | Size |
| --- | --- | --- |
| Release 6 published (patches from 3 bases) | 07:51:08 | |
| Release 6 applied via patch from the APK's own bundle | 07:52:38 | 291 KB (vs 1,530 KB full) |
| Release 7 published | 07:53:44 | |
| Release 7 applied via patch from release 6 (download, patch and verify: 913 ms; apply: 263 ms) | 07:54:00 | **64 KB** |

## Gaps found and next actions

1. ~~Update size.~~ Shell 1.0.2 ships BSDIFF40 patches against the last good bundle or the APK's embedded bundle, verified against the signed sha256, with full download as fallback. Measured on device: 64 KB steady state. Next: build the embedded bundle the same way as OTA bundles so the first patch after install shrinks from 291 KB, and send content edits (copy, prices, images) as CMS data rather than code, which takes them to a few KB.
2. ~~Device rollback is undone by the next check.~~ Fixed in shell 1.0.1 (blocked releases). Fleet rollback added: `rollback-ota` workflow and `pnpm rollback:ota --to N`.
3. ~~Reload vs cold-start detection is a heuristic in JS.~~ Fixed in shell 1.0.1 (native `kind`).
4. ~~MIUI force-dark repaints the app.~~ Fixed in shell 1.0.1 (system dark mode with dark tokens).
5. **Polling every 10 s while open** is a spike setting. Production uses check-on-foreground plus an optional push nudge.
