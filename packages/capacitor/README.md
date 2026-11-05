# @shipvo/capacitor

Signed over-the-air updates for the web bundle of a Capacitor app. It makes the same release decisions and keeps the same trust model as `@shipvo/runtime` (see `docs/adapters.md`).

This is the core, in TypeScript. It does not yet apply a bundle on a device. The native layer (next slice) backs two small interfaces, `KeyValueStore` and `BundleFiles`, and calls `boot()` when the web view loads.

## Install

```bash
npm install @shipvo/capacitor
```

## Example

```ts
import { ShipvoCapacitor, MemoryStore, MemoryFiles } from "@shipvo/capacitor";

const shipvo = new ShipvoCapacitor({
  appId: "tide", shellMajor: 1, shellVersion: "1.2.0", platform: "android",
  publicKey: "<base64 Ed25519 key baked into the shell>",
  baseUrl: "https://cp.example.com",
  store: new MemoryStore(), files: new MemoryFiles(), // the native layer provides real ones
});

const { release, file } = await shipvo.boot();      // which bundle to serve
const r = await shipvo.checkForUpdate({ apply: false });
if (r.status === "staged") console.log("staged release", r.release);
await shipvo.markHealthy();                         // promotes a pending release that is running
console.log((await shipvo.consumeEvents()).events);
```

## How a web bundle is described

The signed release pointer has `kind: "web"` (new, optional field in `@shipvo/schema`). `core` is the one archive file: `url`, `size` and `sha256`. This package refuses a pointer without `kind: "web"`, so a React Native pointer cannot be replayed into a web shell.

## API

`ShipvoCapacitor` implements `ShipvoCapacitorPlugin`, the same methods as `Native` in `packages/runtime/src/index.ts`, all async:

| Method | What it does |
|---|---|
| `getState()` | Cohort, band, running, current, pending, previous and blocked release |
| `checkForUpdate({ apply })` | Fetch the pointer, verify, download, verify, stage. `apply: true` then calls `onReload` |
| `markHealthy()` | Promotes the pending release if it is the one running |
| `consumeEvents()` | Returns and clears queued events: `applied`, `rolled_back`, `crash_loop_revert`, `verify_failed`, `download_failed`, `pointer_rejected:<why>` |
| `rollback()` | Drops pending, blocks current, goes back to previous |
| `reload()` | Calls `onReload` |
| `boot()` | Native layer only. Picks pending (3 trial boots), else current, else the embedded bundle (`release 0`). Applies the crash-loop window and the new-shell reset |
| `markStable()` | Native layer only. Clears the boot counter after the app stayed up |

Checks, in order: Ed25519 signature of the exact body bytes (WebCrypto), kind, platform, app and major, band, newer than current/pending/blocked, `min_shell_version`, then size and sha-256 of the bundle. A bad signature or hash is never staged. A hash mismatch also blocks that release.

Not shared yet: bsdiff patches (rule 9) and Hermes bytecode (rule 6, not relevant to plain web assets). Needs Node 20+ or a web view with WebCrypto Ed25519.
