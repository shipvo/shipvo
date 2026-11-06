---
name: shipvo-runtime
description: Use the Shipvo over-the-air update runtime in an Expo or React Native app. Use when the project depends on @shipvo/runtime and you need to check for an update, mark a release healthy or forward update events.
---

# @shipvo/runtime

The native half of Shipvo updates. It verifies every release (Ed25519 and SHA-256), applies patches, and goes back to the previous release after 3 unhealthy boots.

`shipvo init --dry-run` then `shipvo init --yes` wires it for you. Never print or commit `.shipvo/seed.txt`.

## In the app

```ts
import { Runtime } from "@shipvo/runtime";

const state = Runtime.getState();        // running, pending and previous release, baseUrl, appId
await Runtime.checkForUpdate(true);      // verify, download, stage, apply
Runtime.markHealthy();                   // once the first screen rendered
```

The runtime reports its own events (`crash_loop_revert`, `rolled_back`, `verify_failed`) to telemetry. Use `onRuntimeEvents` to log them. `reportEvents: false` turns reporting off. Do not call `Runtime.consumeEvents()` unless you forward events yourself: it drains the queue before the runtime reports it.

## Config plugin

```json
{ "expo": { "plugins": [["@shipvo/runtime", { "baseUrl": "https://<control plane>", "publicKey": "<base64 public key>", "appId": "myshop" }]] } }
```

Rebuild the native app after you change plugin props.

## Check and release

```bash
shipvo doctor
shipvo status --json
shipvo publish --dry-run
shipvo rollback --to <release>
```
