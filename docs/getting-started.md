# Build your first Shipvo app

Twenty minutes from nothing to an app that AI agents can open in a simulator, that installs on an Android phone, and that you update over the air by pushing to `main`.

## 0. What you need

- Node 22 and npm (or pnpm / bun).
- For the simulator: Chromium via Playwright (one command below). No Android Studio, no Xcode, no phone.
- For phones: Android Studio once (`npx expo run:android`), or EAS Build.
- For publishing: a control plane. Use the hosted one during the beta (ask for an app id) or self-host yours on Cloudflare in ten minutes ([self-hosting.md](self-hosting.md)).

## 1. Create the app

```bash
npx -y @shipvo/cli init myshop --name "My Shop"
cd myshop
npm install
npx playwright install chromium
```

`init` writes a complete Expo app:

| File | What it is |
| --- | --- |
| `shipvo.json` | App id, name, control plane URL, the public key pinned in the shell. Every `shipvo` command reads it. |
| `app.json` | Expo config with the `@shipvo/runtime` plugin (trust root + control plane go into the native shell) and the Expo permission strings. |
| `App.tsx` | A small screen that boots the OTA runtime and exercises the device API: scan, location, fingerprint, notification. |
| `src/release.ts` | The first thing you edit: push a change and every phone and simulator gets it. |
| `metro.config.js` | `withShipvoSim`: simulator builds swap Expo's native modules for the simulated device. |
| `.github/workflows/publish.yml` | Signs and publishes an over-the-air release on every push to `main`. |
| `.shipvo/seed.txt` | Your Ed25519 release signing seed, git-ignored. **Back it up offline.** Lose it and installed shells will never accept another update. |

## 2. Run it in the simulator

```bash
npm run sim
```

This builds the web bundle with the simulated device and serves it on `http://localhost:4545`. Now let an agent use it. In Claude Desktop, Claude Code, Cursor or PiPilot:

```json
{ "mcpServers": { "shipvo": { "command": "npx", "args": ["-y", "@shipvo/mcp"] } } }
```

Ask the agent to `open_app("myshop")`. It gets the first screen as an accessibility tree with refs and can `tap`, `type`, `scroll`, `back`, `screenshot`. Tap "Scan a code" and the Android camera permission dialog appears in the tree; the agent answers it like a person would. `set_device` decides what the phone has:

```
set_device(session, camera: { barcode: { type: "qr", data: "HELLO-123" } }, location: { latitude: 4.05, longitude: 9.7 })
```

`device_log` lists every device event, each marked `simulated: true`. Nothing here is a real camera, fingerprint or payment, and the API never pretends otherwise: `device.capabilities()` returns `simulated` for each capability in the simulator and `real` on a phone.

You can also drive the simulator from a terminal:

```bash
curl -s -X POST localhost:4545/session -H 'content-type: application/json' -d '{"session":"s1","app":"myshop"}'
curl -s -X POST localhost:4545/act -H 'content-type: application/json' -d '{"session":"s1","action":"tap","ref":"e11"}'
```

## 3. Use the device API in your own screens

```tsx
import { device } from "@shipvo/device";
import { ScanHost } from "@shipvo/device/scan";   // mount once at the root; device.camera.scan() then works on phones

const code = await device.camera.scan({ prompt: "Point at the barcode" });   // { type, data } or null
const here = await device.location.current();                               // asks permission first
const auth = await device.auth.confirm("Confirm payment of 4 200 FCFA");    // { ok: true } | { ok: false, reason }
const paid = await device.pay.charge({ provider: "mobile_money", amount: 4200, currency: "FCFA", to: "My Shop", reference: "MS-1", phone: "677000111" }, pin);
await device.notifications.show({ title: "Order confirmed", body: "MS-1 is being prepared", data: { order: "MS-1" } });
device.notifications.onOpen((n) => openOrder(n.data?.order));
```

The full reference is in [device-api.md](device-api.md). Screens built on it run unchanged on phones and in the simulator; the system dialogs are worded as Android or iOS word them depending on the simulated device's platform.

## 4. Put it on a phone

```bash
npx expo run:android          # or: npx eas build -p android
```

The shell contains your public key and control plane URL as manifest meta-data; nothing delivered over the air can change them. The embedded bundle is the first release; every later one is a signed download. iOS builds run the embedded bundle and live content (the OTA runtime is Android today).

## 5. Publish over the air

Set four secrets in your repository (Settings → Secrets → Actions):

| Secret | Value |
| --- | --- |
| `SHIPVO_SIGNING_SEED` | the contents of `.shipvo/seed.txt` |
| `CLOUDFLARE_API_TOKEN` | a token with **Workers KV Storage: Edit** on the control plane's account |
| `CLOUDFLARE_ACCOUNT_ID` | that account |
| `SHIPVO_KV_ID` | the control plane's `POINTERS` KV namespace id |

Then edit `src/release.ts` and push to `main`. The workflow runs `shipvo publish`, which:

1. builds the Hermes bundle and hashes it,
2. builds bsdiff patches from recent releases and from each shell's embedded bundle, so most updates are tens of kilobytes,
3. builds the web artifact of the same commit for the simulator (`/w/<app>/r<N>/`),
4. signs the release pointer (Ed25519) and writes it for each cohort band (`b0` 1 %, `b1` 10 %, `b2` everyone).

Phones check while open, verify signature, hash and size, stage atomically, apply without a restart and mark the release healthy once the first screen renders. A release that fails to boot three times is discarded on that phone. `shipvo rollback --to 7` republishes release 7's code as a new release for everyone.

Agents open the exact release phones run with `open_app("myshop@r8")` or `open_app("myshop@latest")`.

## 6. Give agents a key, not a laptop

The simulator also runs hosted: one Worker spins up a sandbox per API key and exposes the same MCP tools over HTTPS, so ChatGPT or any remote agent can open an app with a URL and nothing installed. `npx -y @shipvo/cli login` signs you in with GitHub and gives you a key; `shipvo mcp` prints the config. During the beta the hosted simulator opens the sample app; hosting your own app there is by arrangement, and self-hosting is always open. See [agents.md](agents.md).

## Where things are measured

Everything above is claimed from measurements on real hardware, published in this repo: OTA sizes and timings on a 2 GB Redmi 9A ([spike-results.md](spike-results.md)), and simulator-vs-device parity on an Android emulator and an iPhone simulator, including what the score does not cover ([parity-results.md](parity-results.md)).
