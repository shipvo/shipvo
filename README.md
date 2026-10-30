<p align="center"><img src=".github/assets/brand/mark-512.png" width="112" alt="Shipvo"></p>

# Shipvo: build once, publish for people and AI agents

**One React Native app, two places it runs.** People get a native Android or iOS app from the stores, kept current with signed over-the-air updates. AI agents get the same release in a phone-sized simulator they can see and operate over MCP, with no device, including native features (camera, location, biometrics, payments, notifications). Every claim about the simulator is measured against real Android and iOS and published.

> Shipvo was briefly called PureNative. Internal identifiers that phones already depend on (the Android package `dev.purenative.tide`, the native runtime module, the current control-plane URL) keep the old name until a shell release migrates them; everything people type or install says Shipvo.

Three pillars:

1. **Publish.** Signed OTA updates (64 KB patches, crash-loop rollback, staged rollouts), a built-in owner admin at `/app/<id>/admin`, and a control plane you can self-host on Cloudflare.
2. **Simulate.** `@shipvo/mcp` opens any Shipvo app for an agent: accessibility tree with refs, tap/type/scroll/back, screenshots. `@shipvo/device` gives apps one device API, real on phones and simulated in the simulator, with Android- and iOS-worded system sheets the agent answers like a person. Simulation is explicit: every simulated event is logged as simulated and no simulated payment or fingerprint is ever presented as real.
3. **Verify.** The parity harness runs the same flows on the simulator, an Android emulator and an iPhone simulator and compares every screen. Current result: 100% matching controls on both platforms across two purchase flows (`docs/parity-results.md`).

[![CI](https://github.com/shipvo/shipvo/actions/workflows/ci.yml/badge.svg)](https://github.com/shipvo/shipvo/actions/workflows/ci.yml)
[![Deploy](https://github.com/shipvo/shipvo/actions/workflows/deploy-control-plane.yml/badge.svg)](https://github.com/shipvo/shipvo/actions/workflows/deploy-control-plane.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Status: pre-launch](https://img.shields.io/badge/status-pre--launch-orange)

> **Status:** pre-launch, measured. OTA numbers come from a real low-end phone (Redmi 9A, 2 GB RAM): `docs/spike-results.md`. Agent results: `docs/agent-gate-results.md`. Simulator-vs-device parity: `docs/parity-results.md`. Native-feature parity (camera, location, permissions, payment prompt) is being measured now and will be published the same way.

## Why Shipvo

Every change to a native mobile app normally means a new build, a store submission, a review, and then waiting for users to update. Many never do. Shipvo separates what has to go through the store from what doesn't:

| Layer | Ships through | Contains |
| --- | --- | --- |
| **Native shell** | App Store / Google Play | Native modules, declared permissions, the signing trust root |
| **Core runtime** | Over the air, signed | The app's JavaScript (Hermes bytecode) |
| **Screens and add-ons** | Over the air, signed | New screens, features and fixes built on capabilities the shell already declares |

Updates are interpreted JavaScript running on native capabilities the shell declares up front. The app never asks for a permission it hasn't declared.

## Features

- **Signed OTA updates:** Ed25519 signatures, verified natively on the device against a public key built into the app. An update can't replace its own trust root.
- **Integrity checks:** SHA-256 and size are verified before a bundle is staged; staging is atomic.
- **Crash-loop protection:** a release that fails to boot 3 times is discarded automatically, and you can roll back to the previous release in one call.
- **Staged rollouts:** cohort bands (1%, 10%, everyone) served as static signed pointers from the edge, with no device registry.
- **Telemetry for every release:** applied, reverted, cold-start time, download size and time.
- **Control plane on Cloudflare Workers:** KV, D1 and R2. It's self-hostable, with a Docker target planned.
- **Admin per app** at `/app/<id>/admin`: live content, prices, offers, orders, history, publish to every phone in seconds; the same typed owner commands are available to agents with a token.
- **Agent-operable apps:** every app exposes typed commands and a UI simulator; `@shipvo/mcp` plugs both into Claude, Cursor, Claude Code or PiPilot.
- **Simulated device:** `@shipvo/device` runs camera, location, biometrics, payments, notifications, share and network on phones (Expo modules) and in the simulator (system sheets in the accessibility tree, state set by the agent). Each capability declares its support level: real, simulated or unavailable.
- **Design skill:** a runnable theme generator, screen checker and anti-generic lint in `skills/shipvo-design`.

## How an update reaches a phone

```
pnpm publish:ota            Build Hermes bundle → SHA-256 → sign pointer (Ed25519)
        │
        ▼
Cloudflare edge             /p/{app}/{shell_major}/{band}.json   (signed envelope, ETag)
        │                   /b/{app}/r{release}.hbc              (immutable bundle)
        ▼
Device runtime (Kotlin)     verify signature → download → verify hash → stage
        │                   → reload → mark healthy → promote, or revert after 3 failed boots
        ▼
Telemetry                   POST /t → D1
```

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/schema` | Contracts: shell manifest, add-on manifest, release pointer, signed envelope, gate report, change log, telemetry (Zod) |
| `packages/cli` | Ed25519 signing, hashing, publishing |
| `services/control-plane` | Hono worker on Cloudflare: pointers, bundles, telemetry, admin |
| `apps/tide-and-tackle` | Sample app and native runtime module used for the spike |
| `skills/shipvo-design` | Design skill with runnable checks |

## Try the sample app

1. Download the latest `tide-and-tackle-shell.apk` from [Releases](https://github.com/shipvo/shipvo/releases) and install it on an Android 7+ phone.
2. Edit `apps/tide-and-tackle/src/release.ts` and push to `main`. The `publish-ota` workflow signs and publishes the release.
3. The app checks every 10 seconds while open, verifies the update, applies it, and logs the timings on screen.

## Develop

```bash
pnpm install
pnpm -r test
pnpm --filter @shipvo/control-plane dev
```

Requires Node 22 and pnpm 10.

## Compared with other OTA tools

Shipvo sits alongside tools like Expo Updates (EAS Update) and self-hosted CodePush servers, which replaced Microsoft App Center CodePush after it was retired in 2025. What Shipvo adds: a declared-capability shell manifest, signed add-ons, a per-app admin, cohort rollouts from static edge files, and apps that AI agents can operate.

## License

Framework: [Apache-2.0](LICENSE). The hosted control plane may be offered under a source-available license; self-hosting stays permitted.
