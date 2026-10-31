# Agents and Shipvo apps

An AI agent uses a Shipvo app the way a person with a screen reader does: it gets the screen as an accessibility tree with refs, and it taps, types, scrolls and goes back. It never sees DOM, React internals or test ids. That is deliberate: what the agent can do in the simulator is what a person can do on the phone, and we measure the match ([parity-results.md](parity-results.md)).

## Three ways to connect

**1. Local, over stdio** (Claude Desktop, Claude Code, Cursor, PiPilot): run `shipvo sim` in the app, then

```json
{ "mcpServers": { "shipvo": { "command": "npx", "args": ["-y", "@shipvo/mcp"] } } }
```

**2. Remote, over Streamable HTTP**: run the MCP server next to a simulator and put it behind HTTPS.

```bash
PN_API_KEYS="key1,key2" npx @shipvo/mcp --http 8787
```
```json
{ "mcpServers": { "shipvo": { "url": "https://sim.example.com/mcp", "headers": { "Authorization": "Bearer key1" } } } }
```

**3. Hosted**: the Shipvo simulator service runs one sandbox per API key and exposes the same tools at `https://sim.shipvo.dev/mcp` (for clients that cannot send headers, such as ChatGPT's custom MCP connectors, the key goes in the path: `/mcp/<key>`). Sessions persist across reconnects; the sandbox sleeps after 30 idle minutes and comes back on the next call. Get a key with `npx -y @shipvo/cli login` (GitHub sign-in; one test key with a sandbox-minute quota for the beta app and the apps you registered with `shipvo app create`; it expires after 30 days and a new login replaces it, `shipvo keys` shows the date), then `shipvo mcp` prints the config for Claude, Cursor and ChatGPT.

## The tools

| Tool | What it does |
| --- | --- |
| `list_apps(query?)` | Apps this key can open: the sample app, your own, and every public app on [shipvo.dev/apps](https://shipvo.dev/apps); `query` searches name, description and category |
| `list_sessions` | Open sessions on this server, to resume after a reconnect |
| `open_app(app, session?, seed_cart?, dark?)` | A phone-sized session; returns the first screen. `myshop` = local build, `myshop@r13` = that published release, `myshop@latest` |
| `screen(session)` | The accessibility tree with refs (`[ref=e12]`) |
| `tap(session, ref)` · `type(session, ref, text)` · `scroll(session, direction, ref?)` · `back(session)` | Act like a thumb |
| `screenshot(session)` | PNG of the phone |
| `set_device(...)` · `device_reset(...)` | What the simulated phone has: platform, permissions, location, barcode in view, biometrics, payment outcome, network |
| `push_notification` · `notifications` · `open_notification` | Deliver, list and tap notifications |
| `device_log(session)` | Every device event, each `simulated: true`, plus capability support levels |
| `end_session(session)` | Steps taken, duration, and the orders the app posted to its backend during the session |
| `owner_describe(app)` · `owner_command(app, command, args)` | The app's owner API (content, prices, offers, orders, publish), with an owner token |

## What the tree shows (and hides), on purpose

- **Rails show only what is on screen.** A horizontal list exposes its visible items; the agent swipes (`scroll right` with the rail's ref) to see more, as on a phone.
- **A modal sheet hides what is behind it** (`aria-modal` / `accessibilityViewIsModal`), so the agent cannot tap through a payment prompt.
- **System dialogs are worded per platform.** Set `platform: "ios"` and the camera prompt becomes "“My Shop” Would Like to Access the Camera" with *Allow / Don't Allow*.
- **Notification banners last 5 seconds**, like a heads-up; after that the shade (`notifications`) is where they live.
- **Nothing simulated is presented as real.** Receipts say `SIMULATED-`, the device log says `simulated: true`, and `device_log` carries a note that no biometric check or money movement took place.

## A complete run (what ChatGPT did against Tide & Tackle)

```
open_app("tide@latest")                                 → Home
set_device(camera: { barcode: { type: "qr", data: "6181234567890" } }, location: { latitude: 4.0225, longitude: 9.6967 })
tap "Scan a product barcode" → dialog "Allow Tide & Tackle to take pictures and record video?" → tap "While using the app"
                                                        → Scanner → "Surface Popper 9 cm · 4,200 FCFA" → tap "Add 1 to cart"
tap "Open cart" → "Choose delivery and pay" → "Use my location" → dialog → "While using the app" → "0.7 km from the shop"
tap "Any day · Shop pickup" → "Mobile money" → type 677000111 → "Place order"
dialog "Confirm with fingerprint" → tap "Use fingerprint" → sheet "Mobile money payment" → type PIN 1234 → "Confirm payment"
                                                        → "Order TT-1001 placed · Receipt SIMULATED-…" + notification banner
notifications → open_notification                        → My orders
device_log → 6 events, all simulated: true
end_session → { steps: 18, orders: [{ id: "TT-1001", total: 4200, payment: "mobile_money", status: "placed", receipt: "SIMULATED-…" }] }
```

18 steps, 76 seconds, no phone. The same flow runs on a real Android emulator with identical screens and the same order ([parity-results.md](parity-results.md)).

## Owner API: agents that run the shop

With an owner token, the same MCP server exposes the app's typed owner commands: change content, prices and offers, read orders, publish to every phone. Every change is audited with who made it. `owner_describe("tide")` lists the commands with their arguments; the admin at `/app/<id>/admin` is the same API with a form on top.

## Grading an agent

`end_session` returns what the app actually sent to its backend, not what the agent says it did. The Tide & Tackle repo has an agent-eval harness that scores tasks that way ([agent-gate-results.md](agent-gate-results.md)).

## Listing your app for every agent

A published app is private to your key until you list it. In `shipvo.json`:

```json
{ "listing": { "public": true, "description": "Fishing-supplies shop in Douala: catalogue, cart, mobile money.", "category": "shop" } }
```

Run `shipvo app create` again. After a short review it appears on [shipvo.dev/apps](https://shipvo.dev/apps) and in `list_apps` for every signed-in key, and any agent can `open_app("<id>@latest")`. Opening a public app spends the opener's sandbox minutes, not yours. Set `public` to `false` and run `shipvo app create` to withdraw. Categories: shop, food, travel, finance, health, education, services, tools, games, other.
