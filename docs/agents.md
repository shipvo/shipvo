# Agents and Shipvo apps

An AI agent uses a Shipvo app the way a person with a screen reader does: it gets the screen as an accessibility tree with refs, and it taps, types, scrolls and goes back. It never sees DOM, React internals or test ids. That is deliberate: what the agent can do in the simulator is what a person can do on the phone, and we measure the match ([parity-results.md](parity-results.md)).

## Install the Shipvo skill

```bash
npx skills add shipvo/shipvo --skill shipvo -g
```

The skill (`skills/shipvo/SKILL.md`) gives your coding agent the exact `shipvo` commands for setup, running on Shipvo Phone, testing over MCP, publishing and rolling back, the store path and demo recordings. `shipvo agents setup` writes `AGENTS.md` and `.mcp.json` for you ([CLI](cli.md#shipvo-agents-setup)). `https://shipvo.dev/install.sh` is planned ([#533](https://github.com/shipvo/shipvo/issues/533)).

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
| `open_app(app, session?, seed_cart?, dark?, attach?)` | A phone-sized session; returns the first screen. If `shipvo run` is up for this app (`.shipvo/run.json` in the working directory or a parent, up to the git root), the session drives that phone instead and the result says `attached to the live shipvo run phone`; otherwise it says `headless session`. `attach`: `auto` (default), `never` (always headless), `always` (error with no live run). Attached sessions support screen, tap, type, scroll, back; other tools return `not_supported_attached`. Attach needs Node 22+; if attach fails in `auto` mode the headless result says why. `app@release` still attaches to the local run. `myshop` = local build, `myshop@r13` = that published release, `myshop@latest` |
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

## Turn a session into a test

`export_test` turns the steps an agent took in a session into a `@shipvo/test` script. Targets are named by their visible text, because refs like `e7` change between sessions. A password field uses an environment variable, never the typed value. Anything the tool cannot name safely becomes a `// TODO` comment.

A test in this repo does the whole loop on the Tide & Tackle sample app. It opens the app through the MCP server, taps "My orders", goes back and taps "Department Rods", calls `export_test`, writes the script to a temp file and runs it with Vitest against the simulator. To print the script and the Vitest output:

```bash
REPLAY_DEBUG=1 pnpm --filter @shipvo/mcp exec vitest run test/export-replay.test.ts
```

The script `export_test` returned:

```ts
import { test } from "@shipvo/test/vitest";
import { openApp } from "@shipvo/test";

test("recorded session for tide", async () => {
  const phone = await openApp({ app: "tide" });
  await phone.tap("My orders");
  await phone.waitFor(/\S/); // TODO: name the text that should appear
  await phone.back();
  await phone.waitFor(/\S/); // TODO: name the text that should appear
  await phone.tap("Department Rods");
  await phone.waitFor(/\S/); // TODO: name the text that should appear
});
```

What Vitest printed when it ran that file, with no agent and no MCP server:

```
 RUN  v2.1.9

 ✓ recorded.replay.ts > recorded session for tide 2647ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
```

The `waitFor(/\S/)` lines only wait for the screen to have some text. Replace each with the text you expect, so the test checks something. The test ran Vitest against the simulator in headless Chromium.

## Walk an app with `shipvo explore`

`shipvo explore` is a walker with no LLM inside. It starts the simulator on your app, opens the start screen and each deep link in `routes` in `shipvo.json`, and taps every actionable element once, going back after each. It stops at `--max-steps` (default 100) and `--max-depth` (default 3) and says so in the report.

```bash
shipvo explore --max-steps 100 --max-depth 3
shipvo explore --sim http://localhost:4545   # use a simulator that is already running
shipvo explore --fail-on-findings            # exit 1 when there are findings (default: exit 0)
```

It writes `explore-report.md` and `explore-report.json`. The report has four kinds of finding, each with the steps to reach it as typed steps (`open`, `open_url`, `tap` by role and name, `back`):

- an uncaught error or a red screen;
- a tap that was `not_delivered`;
- a dead end: a screen with no actionable element;
- an actionable element with no accessible name.

The header lists what the simulator cannot show. A clean run says "No findings in N steps", never that a screen is fine. Exit code 1 also means the walk itself failed (for example the simulator could not start or a step failed). If it fails mid-walk, the report is still written with the findings so far and `stoppedEarly` says why; the error is also printed to stderr. If it fails before the walk starts, no report is written.

## Owner API: agents that run the shop

With an owner token, the same MCP server exposes the app's typed owner commands: change content, prices and offers, read orders, publish to every phone. Every change is audited with who made it. `owner_describe("tide")` lists the commands with their arguments; the admin at `/app/<id>/admin` is the same API with a form on top.

**Confirm before anything that cannot be undone.** These owner commands reach customers or cannot be undone: `publish`, `update_product` with a new price, `remove_product`, `upsert_promo`, `set_promo_active`, `remove_home_block`, `discard_draft` (when the draft has changes), `create_api_key` and `revoke_api_key`. When an agent calls one without `confirm: true`, nothing changes and the result is `{ ok: false, code: "needs_confirm", plan: [...] }`. The plan says what would change and who it reaches; for `publish` it includes how many update reports the server has received (telemetry has no device id, so the number of phones is not known). The control plane cannot check that the plan was shown to the owner, so the agent must show it. Show it to the owner, then call again with the same arguments and `confirm: true`. Every call that ran after `confirm: true` is written to the audit log (`audit_log`) with who, what and when, and `"confirmed": true`. A refused call is logged with `"denied": true`. A call that ran under `agentPolicy: "allow"` is logged without `confirmed`. Changes to the policy (`set_agent_policy`) are logged with the admin as actor. No owner command sends notifications today.

Owner rules, in `shipvo.json` or (for the control plane) with the `set_agent_policy` command, which only a signed-in owner can run:

```json
{ "agentPolicy": "ask", "agentDeny": ["remove_product"] }
```

- `agentPolicy` is `"ask"` (default: the confirm step above), `"deny"` (those commands are refused with code `denied`) or `"allow"` (no confirm step; never the default, and only the control plane's own setting can turn it on).
- `agentDeny` lists commands agents may never run, confirm or not.
- The `shipvo.json` read by `@shipvo/mcp` (from `PN_APP_DIR` or the current folder) can only make the rules stricter than the control plane's.
- The signed-in admin at `/app/<id>/admin` is not gated: the confirm step is for agents holding the owner token.

## Grading an agent

`end_session` returns what the app actually sent to its backend, not what the agent says it did. The Tide & Tackle repo has an agent-eval harness that scores tasks that way ([agent-gate-results.md](agent-gate-results.md)).

## Listing your app for every agent

A published app is private to your key until you list it. In `shipvo.json`:

```json
{ "listing": { "public": true, "description": "Fishing-supplies shop in Douala: catalogue, cart, mobile money.", "category": "shop" } }
```

Run `shipvo app create` again. After a short review it appears on [shipvo.dev/apps](https://shipvo.dev/apps) and in `list_apps` for every signed-in key, and any agent can `open_app("<id>@latest")`. Opening a public app spends the opener's sandbox minutes, not yours. Set `public` to `false` and run `shipvo app create` to withdraw. Categories: shop, food, travel, finance, health, education, services, tools, games, other.
