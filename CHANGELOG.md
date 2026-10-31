# Changelog

Dated, newest first. Package versions are on npm under `@shipvo`.

## 2026-10-31

- **MCP fix:** `open_app` `seed_cart` now accepts `{ product_id, quantity }` as well as `{ id, qty }` and passes the shape the app reads; the cart no longer shows "NaN items". `@shipvo/mcp` 0.0.5.
- **Test your app in CI.** New package `@shipvo/test`: typed end-to-end tests that run your app in the headless simulator, in Vitest or any runner (`openApp`, `phone.tap/type/waitFor`, `phone.device.set({ location, camera, permissions, biometrics, payment, online })`, notifications, a `toSee` matcher). `shipvo init` now scaffolds `tests/app.test.ts`, a `test.yml` workflow, and gates the OTA publish on it. This repo's CI runs a typed purchase test (scan, location, mobile money, fingerprint, PIN, confirmation) and a declined-payment test on every push. New docs page: [Test your app in CI](docs/testing.md), and a homepage section.
- **iOS over-the-air updates.** `@shipvo/runtime` now has a Swift runtime for iOS with the same rules as Android: Ed25519 and SHA-256 checks against the key pinned in the app, staged releases on trial, a healthy-start promotion, crash-loop rollback, and a new app binary discarding old bundles. Publish with `shipvo publish --platform ios` or `--platform all` (default stays Android); `shipvo rollback` takes `--platform` too. iOS pointers live at their own path and carry `platform: "ios"` in the signed body, so an Android pointer can never be replayed on iOS. Verified in CI on macOS: 11 logic tests, plus a simulator run that builds the sample app, updates it over the air to release 1 and cold-starts on it. Not yet: bsdiff patches on iOS (full bundles only) and measurement on physical iPhones.
- **Site:** a theme switcher in the nav (automatic, light or dark), remembered in your browser.
- **CLI fix:** the scaffolded `src/release.ts` could break the CLI build; fixed.

- **For AI tools:** [`/llms.txt`](/llms.txt), [`/llms-full.txt`](/llms-full.txt), every docs page as Markdown (`/docs/<page>.md`), a [`/docs.md`](/docs.md) index, `sitemap.xml` (includes listed apps) and `robots.txt`.
- **Legal:** [Terms](/terms/), [Privacy](/privacy/), [Acceptable use](/acceptable-use/) and [Security](/security/) pages, plus `/.well-known/security.txt`.
- **Site:** an animated release-to-devices illustration, a real device in the hero, and the licence is now stated correctly everywhere (Apache-2.0).

- **`shipvo keys export` / `shipvo keys import`** back up and restore the release signing seed, checked against the public key in `shipvo.json`. New docs page: [Moving to a new machine](docs/new-machine.md).

- **shipvo.dev** goes live: landing page, public marketplace (`/apps`), and a docs site built from this repo's Markdown on every deploy.
- **Hosted publishing.** `shipvo app create` registers an app under your GitHub account and returns a publish token scoped to that app; `shipvo publish` writes through `api.shipvo.dev`, and every release pointer is verified against the app's registered public key. `shipvo app list` and `shipvo app delete`.
- **Marketplace.** Set `listing.public` in `shipvo.json`; after review the app appears on shipvo.dev/apps, in `list_apps` for every signed-in key, and any agent can `open_app("<id>@latest")`.
- **Self-serve login.** `shipvo login` signs in with GitHub (device flow) and issues a 30-day key with a sandbox-minute quota; a new login replaces the previous key.
- **Custom domains.** `api.shipvo.dev` (control plane) and `sim.shipvo.dev` (hosted simulator); the earlier `workers.dev` addresses stay live for installed shells.
- **MCP** 0.0.4: `list_apps(query)`, `list_sessions`, `notifications`, `open_notification`.
- **iOS parity flow C** (camera permission, scanner, location permission, distance, mobile money): 100 % actionable parity; the harness now drives iOS system dialogs through the alert API. Nightly parity runs on Android and iOS.
- **Device E2E** regression: ChatGPT's 18-step purchase runs in CI through MCP on every push.
- **Tide & Tackle** releases 19–22; shell 1.1.0 as `dev.shipvo.tide`.
- Packages: `@shipvo/cli` 0.1.1, `@shipvo/mcp` 0.0.4, `@shipvo/sim` 0.1.1, `@shipvo/runtime` 0.1.0, `@shipvo/device` 0.1.0.

## 2026-10-30

- **Hosted simulator** on E2B: one sandbox per API key, sessions survive client reconnects, the key may travel in the URL for clients that cannot send headers (ChatGPT).
- **Modal semantics** on every platform: a sheet hides what is behind it from the accessibility tree, in the app itself rather than in a driver heuristic.
- **Found by parity, fixed in the app:** the iOS number pad covered "Confirm payment"; the payment sheet now rises above the keyboard.
- Android and iOS drivers stop swiping over system dialogs, verify typed values, and save raw trees at key screens.
- `@shipvo/mcp` 0.0.2: Streamable HTTP transport with API keys.

## 2026-10-29 and earlier

- Shipvo (then PureNative): Ed25519-signed release pointers, SHA-256 bundles, bsdiff patches, cohort bands, `min_shell_version` gating, OTA measured on a 2 GB Redmi 9A.
- The UI simulator over Playwright with accessibility-tree screens and refs; the simulated device (camera, location, biometrics, payments, notifications); the agent gate.
- First parity runs against an Android emulator and an iPhone simulator; the design skill.
