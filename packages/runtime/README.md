# @shipvo/runtime

The native half of Shipvo's over-the-air updates, as an Expo module.

- Verifies every release pointer (Ed25519) and bundle (SHA-256 + size) against a public key built into the shell.
- Downloads bsdiff patches when it has the previous release, full bundles otherwise; stages atomically.
- Applies without restart, marks the release healthy when the app says so, and discards a release that fails to boot 3 times.
- Android and iOS. iOS downloads full bundles (patches are Android-only for now) and is verified on the iOS Simulator in CI; in the web simulator the app runs the same release as the web build.

```json
{ "expo": { "plugins": [["@shipvo/runtime", { "baseUrl": "https://<your control plane>", "publicKey": "<base64 Ed25519 public key>", "appId": "myshop" }]] } }
```

```ts
import { Runtime } from "@shipvo/runtime";
const s = Runtime.getState();            // running / pending / previous release, band, baseUrl, appId
await Runtime.checkForUpdate(true);      // verify, download (patch if possible), stage, apply
Runtime.markHealthy();                   // call once the first screen rendered
```

`shipvo init` wires all of this for you.
