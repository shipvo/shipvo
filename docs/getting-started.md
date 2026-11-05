# Build your first Shipvo app

Also in: [Français](fr/getting-started.md)

<video controls preload="metadata" playsinline tabindex="0" data-title="Ship an update to phones in minutes" data-length="1 min 30 s" poster="/videos/ship-an-update.png" src="/media/videos/ship-an-update-988335b3.mp4"><track kind="captions" src="/videos/ship-an-update.vtt" srclang="en" label="English" default>Your browser cannot play this video. See the video page for a transcript.</video>

Video: [Ship an update to phones in minutes](videos.md), 1 min 30 s, with captions and a transcript.

This guide takes you from nothing to an app that AI agents can open in a simulator, that installs on an Android phone, and that you update over the air with one command, `shipvo publish`.

What we measured: on 2026-11-05, on a GitHub Actions Linux runner (4 vCPU, AMD EPYC 7763, Node 22), `shipvo init` took 100 ms and `shipvo publish --dry-run` took 107 ms, run offline. Those two numbers skip the bundle export (`--skip-export`). A full run on the same kind of runner, with the real export, took 12 s with `--skip-web true` and 18 s without it ([dogfood report](product/dogfood/2026-11-05-habits.md)). We did not time store builds. See [`scripts/first-run/`](../scripts/first-run/) to re-run it.

## 0. What you need

- Node 22 and npm (or pnpm / bun).
  Check with `node --version`. It must print `v22` or higher. If not, run `nvm use 22` or install Node 22 from nodejs.org.
- For the simulator: Chromium via Playwright (one command below). No Android Studio, no Xcode, no phone.
- For phones: Android Studio once (`npx expo run:android`), or EAS Build.
- For publishing: a control plane. Use the hosted one (`shipvo login`, then `shipvo app create`, both below) or self-host yours on Cloudflare ([self-hosting.md](self-hosting.md)).

## 1. Create the app

```bash
npx -y @shipvo/cli init myshop --name "My Shop"
cd myshop
npm install
npx playwright install chromium
```

If something fails, run `npx shipvo doctor` in `myshop`. Each line starts with PASS or FAIL, and a FAIL line ends with the exact fix. It checks your Node version, `shipvo.json`, the signing key, control plane reachability and `hermesBytecodeVersion`. If `package.json` has a `sim` script, it also checks that Playwright Chromium is installed and that port 4545 is free (use `--port <n>` to check another port).

`init` also writes `tests/app.test.ts`, which tests the starter screen. When you replace `App.tsx` with your own screens, replace or delete that file too, or `npm test` fails on buttons that no longer exist.

To start from a reader app instead, add `--template content`: a list screen and a detail screen that read titles and text from `src/data/articles.json`, with a matching `tests/app.test.ts`. `--template blank` is the default. `shipvo init --help` lists the templates.

`init` writes a complete Expo app:

| File | What it is |
| --- | --- |
| `shipvo.json` | App id, name, control plane URL, the public key pinned in the shell. Every `shipvo` command reads it. |
| `app.json` | Expo config with the `@shipvo/runtime` plugin (trust root + control plane go into the native shell) and the Expo permission strings. |
| `App.tsx` (blank template) | A small screen that boots the OTA runtime and exercises the device API: scan, location, fingerprint, notification. |
| `src/release.ts` | The first thing you edit: push a change and every phone and simulator gets it. |
| `metro.config.js` | `withShipvoSim`: simulator builds swap Expo's native modules for the simulated device. |
| `.github/workflows/publish.yml` | Runs `shipvo publish` for you on every push to `main` (optional; you can always run it yourself). |
| `.shipvo/seed.txt` | Your Ed25519 release signing seed, git-ignored. **Back it up offline.** Lose it and installed shells will never accept another update. Run `shipvo keys export` and keep a copy ([moving machines](new-machine.md)). |

## 2. Run it in the simulator

```bash
npm run sim
```

This builds the web bundle with the simulated device and serves it on `http://localhost:4545`. Add `--watch` (`shipvo sim --watch`) to rebuild when you edit files: it waits 300 ms after the last change, prints `rebuilt in 5.8 s` or the build error, and keeps serving the last good build if a build fails. It ignores `node_modules`, `sim-dist`, `.shipvo`, `.git`, `.expo`, `dist`, `dist-ota`, `web-build`, `ios` and `android`. The simulator page does not reload by itself: reopen the app to see the change. Now let an agent use it. In Claude Desktop, Claude Code, Cursor or PiPilot:

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

The shell contains your public key and control plane URL as manifest meta-data; nothing delivered over the air can change them. The embedded bundle is the first release; every later one is a signed download. On iOS the same runtime verifies and applies releases published with `shipvo publish --platform ios` (or `all`); iOS downloads full bundles, not patches, for now.

## 5. Publish over the air

**Hosted control plane (the default).** Sign in once and register the app:

```bash
npx -y @shipvo/cli login          # GitHub sign-in; saves your key
npx -y @shipvo/cli app create     # registers the app id + your public key, saves a publish token to .shipvo/publish-token
```

For CI, add two repository secrets (Settings → Secrets → Actions):

| Secret | Value |
| --- | --- |
| `SHIPVO_SIGNING_SEED` | the contents of `.shipvo/seed.txt` |
| `SHIPVO_PUBLISH_TOKEN` | the contents of `.shipvo/publish-token` (valid 90 days; run `shipvo app create` again for a new one) |

The publish token can only write your app's own files, and every release pointer must verify against the public key you registered, so a leaked token cannot ship code to your users without your signing seed. The seed never leaves your machine or CI.

**Self-hosted control plane.** Instead of the token, set `CLOUDFLARE_API_TOKEN` (Workers KV Storage: Edit), `CLOUDFLARE_ACCOUNT_ID` and `SHIPVO_KV_ID` (see [self-hosting.md](self-hosting.md)) and point `controlPlane` in `shipvo.json` at your Worker.

Then edit `src/release.ts` and run `shipvo publish`. (In a GitHub repo, the workflow does the same on every push to `main`.) It:

1. builds the Hermes bundle and hashes it,
2. builds bsdiff patches from recent releases and from each shell's embedded bundle, so most updates are tens of kilobytes,
3. builds the web artifact of the same commit for the simulator (`/w/<app>/r<N>/`),
4. signs the release pointer (Ed25519) and writes it for each cohort band (`b0` 1 %, `b1` 10 %, `b2` everyone).

To check a release before you have a control plane or token, run `shipvo publish --dry-run [--out dir]`. It builds, signs and writes everything to `dir` (default `.shipvo/dry-run`), sends nothing, and prints a short summary (release, size in KB below 1 MB and MB above, folder). Layout: `b/<app>/r<N>.hbc` (bundle), `p/<app>/<major>/<band>` (signed pointers; iOS under `p/<app>/<major>/ios/`), `h/<app>/r<N>` (release record), `w/<app>/r<N>/` (web export; add `--skip-web true` to skip it and run faster). The release is 1 unless you pass `--release N`, and no patches are built offline. Old files in `dir` are not cleared. To preview a rollback, run `shipvo rollback --to <n> --dry-run`. It reads release `<n>`'s bundle, prints a summary and writes nothing. It still needs access to the control plane or KV to read the bundle, so it is not offline like `publish --dry-run`.

If your first publish fails, run `shipvo doctor` first. It checks your Node version, `shipvo.json`, signing key match, control plane reachability, and `hermesBytecodeVersion` when present.

Phones check while open, verify signature, hash and size, stage atomically, apply without a restart and mark the release healthy once the first screen renders. A release that fails to boot three times is discarded on that phone. `shipvo rollback --to 7` republishes release 7's code as a new release for everyone.

Agents open the exact release phones run with `open_app("myshop@r8")` or `open_app("myshop@latest")`.

## 6. Give agents a key, not a laptop

The simulator also runs hosted: one Worker spins up a sandbox per API key and exposes the same MCP tools over HTTPS, so ChatGPT or any remote agent can open an app with a URL and nothing installed. `npx -y @shipvo/cli login` signs you in with GitHub and gives you a key; `shipvo mcp` prints the config (signed out, it prints the local config for `shipvo sim`). Your key opens the sample app and every app you registered with `shipvo app create`: after a publish, `open_app("myshop@latest")` opens the exact release phones run. The beta allows 3 apps per account and 500 MB each; self-hosting is always open. See [agents.md](agents.md).

## Where things are measured

Everything above is claimed from measurements on real hardware, published in this repo: OTA sizes and timings on a 2 GB Redmi 9A ([spike-results.md](spike-results.md)), and simulator-vs-device parity on an Android emulator and an iPhone simulator, including what the score does not cover ([parity-results.md](parity-results.md)).
