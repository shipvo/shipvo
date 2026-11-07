# Agents and Shipvo apps

An AI agent uses a Shipvo app the way a person with a screen reader does: it gets the screen as an accessibility tree with refs, and it taps, types, scrolls and goes back. It never sees DOM, React internals or test ids. That is deliberate: what the agent can do in the simulator is what a person can do on the phone, and we measure the match ([parity-results.md](parity-results.md)).

## Install the Shipvo skill

```bash
npx skills add shipvo/shipvo --skill shipvo -g
```

The skill (`skills/shipvo/SKILL.md`) gives your coding agent the exact `shipvo` commands for setup, running on Shipvo Phone, testing over MCP, publishing and rolling back, the store path and demo recordings. Without the skill tool: `curl -fsSL https://shipvo.dev/install.sh | bash` on macOS and Linux, or `irm https://shipvo.dev/install.ps1 | iex` in Windows PowerShell. Or paste this to your agent: "Set up Shipvo in this project: run `npx -y @shipvo/cli agents setup`, then follow what it prints." All three lines are on [shipvo.dev/setup](https://shipvo.dev/setup/).

## Skills that ship with each package

`@shipvo/mcp`, `@shipvo/test`, `@shipvo/runtime` and `@shipvo/cli` each ship a short skill in `skills/<name>/SKILL.md` (`shipvo-mcp`, `shipvo-test`, `shipvo-runtime`, `shipvo-cli`). `shipvo agents setup` copies the skill of every installed `@shipvo/*` package your `package.json` depends on into `.agents/skills/` and `.claude/skills/`. A package you do not depend on is not copied. A second run changes nothing, and `--dry-run` lists the files without writing. `shipvo skills sync` runs only this step. `shipvo status --json` reports each one in `data.skills` as `{ package, name, synced }`.

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

**3. Hosted**: the Shipvo simulator service runs one sandbox per API key and exposes the same tools at `https://sim.shipvo.dev/mcp` (for clients that cannot send headers, such as ChatGPT's custom MCP connectors, the key goes in the path: `/mcp/<key>`). To sign in with GitHub instead of copying a key, run `claude mcp add --transport http shipvo https://sim.shipvo.dev/mcp` and approve the sign-in in your browser. Sessions persist across reconnects; the sandbox sleeps after 30 idle minutes and comes back on the next call. Get a key with `npx -y @shipvo/cli login` (GitHub sign-in; one test key with a sandbox-minute quota for the beta app and the apps you registered with `shipvo app create`; it expires after 30 days and a new login replaces it, `shipvo keys` shows the date), then `shipvo mcp` prints the config for Claude, Cursor and ChatGPT. To test a build from your machine, see [Test your build on the hosted phone](test-your-build.md).

## The tools

| Tool | What it does |
| --- | --- |
| `list_apps(query?)` | Apps this key can open: the sample app, your own, and every public app on [shipvo.dev/apps](https://shipvo.dev/apps); `query` searches name, description and category |
| `list_sessions` | Open sessions on this server, to resume after a reconnect: app, platform, room, who opened it, start time and screen title |
| `open_app(app, session?, seed_cart?, dark?, attach?, platform?, show?, room?)` | A phone-sized session; returns the first screen. If `shipvo run` is up for this app (`.shipvo/run.json` in the working directory or a parent, up to the git root), the session drives that phone instead and the result says `attached to the live shipvo run phone`; otherwise it says `headless session`. `attach`: `auto` (default), `never` (always headless), `always` (error with no live run). `show: true` opens the phone in your browser and starts `shipvo run <platform>` when none is up; by default that happens only on a desktop machine whose project has `shipvo` installed. A server over HTTP never starts a run. `platform` applies only when a phone is started; with `show: false`, `attach: never` or a live run attached as it is, the result says it was ignored. Attached sessions support screen, tap, type, scroll, back and screenshot; other tools return `not_supported_attached`. Attach needs Node 22+; if attach fails in `auto` mode the headless result says why. `app@release` still attaches to the local run. `myshop` = local build, `myshop@r13` = that published release, `myshop@latest` |
| `upload_build(dir?, app?, skip_build?)` | Build this project, upload it for your key and return a build id. Open it on the hosted phone with `open_app("<app>@build:<id>")`. Local (stdio) server only. See [Test your build](test-your-build.md) |
| `attach_session(app?, session?)` | Attach to the live `shipvo run` phone (Android or iOS) from `.shipvo/run.json`, without an app id. Returns `no_live_run` when no run is up (or `app` does not match it) and `attach_failed` when the phone cannot be reached |
| `screen(session)` | The accessibility tree with refs (`[ref=e12]`) |
| `tap(session, ref)` · `type(session, ref, text)` · `scroll(session, direction, ref?)` · `back(session)` | Act like a thumb |
| `screenshot(session)` | PNG of the phone |
| `set_device(...)` · `device_reset(...)` | What the simulated phone has: platform, permissions, location, barcode in view, biometrics, payment outcome, network |
| `lock` · `unlock` · `restart` | Press the power button (lock screen), swipe up to unlock, or restart the phone (boot screen, the app starts fresh, storage is kept). While locked, tap, type, scroll and back fail with `phone_locked` |
| `open_notifications` · `open_control_center` · `toggle_tile` · `dismiss_notification` · `close_panels` | Pull down the notification shade (Android: first call shows a few tiles and notifications, second call all tiles) or Notification Center (iPhone), open Control Center (iPhone only), flip a tile (`wifi`, `mobile_data`, `airplane`, `location`, `dark_mode`, `dnd`, `auto_rotate`, `flashlight`; iPhone: `airplane`, `wifi`, `mobile_data`, `focus`, `orientation_lock`, `brightness`, `dark_mode`), swipe away a notification or clear all. A tile changes the simulated device like `set_device`: Wi-Fi and mobile data both off take the network offline, `dark_mode` sets the app's `prefers-color-scheme`, `dnd` stops heads-up banners. Typed errors: `tile_not_visible`, `unknown_tile`, `no_control_center`, `no_such_notification`, `panel_closed`. While a panel is open, `tap`, `type` and `scroll` fail with `panel_open` (call `close_panels` first), as the panel covers the app. Panel actions need the app in the foreground. `dismiss_notification` without an `id` removes the newest notification. |
| `press_home` · `open_recents` · `resume_app` · `kill_app` | Home (app gets `AppState` background, home screen shows the app icon), app switcher card, bring the app back (`active`), swipe the card away (next open is a cold start). While away, tap, type, scroll, back, `open_url` and `open_notification` fail with `app_not_foreground`; `screenshot` shows the home screen or switcher |
| `push_notification` · `notifications` · `open_notification` | Deliver, list and tap notifications |
| `get_settings` · `set_setting` · `browser_open` · `browser_snapshot` · `browser_click` · `browser_type` · `browser_scroll` · `browser_back` · `browser_wait_for` · `browser_tabs` · `browser_close_tab` · `browser_screenshot` | Read and change the phone's system settings, and drive its separate web Browser. See [the phone's Browser and Settings](phone-apps.md) |
| `device_log(session)` | Every device event, each `simulated: true`, plus capability support levels |
| `end_session(session)` | Steps taken, duration, and the orders the app posted to its backend during the session |
| `owner_describe(app)` · `owner_command(app, command, args)` | The app's owner API (content, prices, offers, orders, publish), with an owner token |

## Rooms: several phones, one backend

Give `open_app` the same `room` on two sessions and both phones share one backend: an order placed on one shows up for the other. Use it to test two people in one app, for example a buyer and a shop owner, on Android and iOS. Without `room`, a session gets its own backend. A room name that is not valid returns `bad_room`. A room ends when its last session ends, and `end_session` names the room and its orders.

## Driving the live phone

When `shipvo run` is up for your app, `open_app` attaches to that phone and the person watching sees what the agent does:

- a dot at each tap point, an outline around the target, and an "Agent is driving" banner;
- a step log in plain words, such as `Tapped button "Add to cart"`. Events from the simulated device are marked "(simulated)". **Hide steps** collapses the log so it never covers the app.

The person can stop the agent at any time. Any touch or key press on the phone pauses it, once the agent has made its first request. The next tool call fails with `taken_over` and the text "the person took over". Stop acting and ask the person to press **Hand back** on the banner; then call `screen` and carry on. An action already in flight when the person takes over still finishes, and its step is logged after "You took over".

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

18 steps, 76 seconds, no phone. The same flow runs on an Android emulator with the same actionable elements (role and label) on each screen and the same order placed. Enabled state, element order and bounds are not compared yet ([parity-results.md](parity-results.md)).

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

`shipvo explore` is a walker with no LLM inside. It starts the simulator on your app, opens the start screen and each deep link in `routes` in `shipvo.json`, and walks the app. It picks the next screen to explore by how little it has been seen (an upper confidence bound), so new screens come first. It taps buttons whose labels end a session or destroy data, such as "Log out" or "Delete", last. It types sample text into text fields and submits them. It stops at `--max-steps` (default 100) and `--max-depth` (default 3) and says so in the report.

```bash
shipvo explore --max-steps 100 --max-depth 3
shipvo explore --sim http://localhost:4545   # use a simulator that is already running
shipvo explore --seed 1                     # the same seed repeats the same run
shipvo explore --save-tests tests/lumi      # write one @shipvo/test file per finding
shipvo explore --skin ios                   # small-target minimum 44 instead of 48
shipvo explore --fail-on-findings            # exit 1 when there are findings (default: exit 0)
shipvo explore --issues-dir issues           # one ready-to-file issue per finding
```

With `--issues-dir <dir>`, it also writes one Markdown file per distinct finding, `<n>-<kind>.md`. The first line is the title (`explore: <kind> on <screen>`), then the message, the numbered steps, the platform skin and the simulator limits. It does not call GitHub. It prints one `gh issue create --title ... --body-file ...` line per file for you or your agent to run. With no findings it writes nothing and says so.

It writes `explore-report.md` and `explore-report.json`. The report has nine kinds of finding, each with the steps to reach it as typed steps (`open`, `open_url`, `tap` by role and name, `type`, `back`):

- an uncaught error or a red screen;
- a tap that was `not_delivered`;
- a dead end: a screen with no actionable element;
- an actionable element with no accessible name (`unnamed`);
- `small_target`: an actionable element rendered under the minimum tap size, 44 x 44 for iOS (Apple HIG) and 48 x 48 for Android. The simulator is an Android phone, so the default is 48; pass `--skin ios` for 44;
- `duplicate_name`: two or more actionable elements on one screen with the same role and name, which a screen reader cannot tell apart;
- `network_failed`: the app threw a network error, or the screen shows text such as "Network request failed";
- `stuck_loading`: the screen still shows a loading indicator (progress bar or spinner) after the walker looks again twice;
- `blank_screen`: nothing is drawn on the screen, no names and no text.

The header lists what the simulator cannot show. A clean run says "No findings in N steps", never that a screen is fine. Exit code 1 also means the walk itself failed (for example the simulator could not start or a step failed). If it fails mid-walk, the report is still written with the findings so far and `stoppedEarly` says why; the error is also printed to stderr. If it fails before the walk starts, no report is written.

## Owner API: agents that run the shop

With an owner token, the same MCP server exposes the app's typed owner commands: change content, prices and offers, read orders, publish to every phone. Every change is audited with who made it. `owner_describe("tide")` lists the commands with their arguments; the admin at `/app/<id>/admin` is the same API with a form on top.

**Read the audit log.** `audit_log` is a read-only tool. It returns the app's audit rows newest first, so an agent can check "was this release already rolled back?" before it acts. Inputs: `app`, `limit` (default 50, clamped to 1..200) and `action` (only rows with that action). It needs the owner token, and it never calls `owner_command`. Errors carry a `code`: `unauthorized` or `not_found`.

```json
{ "name": "audit_log", "arguments": { "app": "tide", "action": "rollback", "limit": 5 } }
```

```json
{ "app": "tide", "rows": [{ "actor": "agent", "action": "rollback", "subject": "r42", "at": "2026-11-05T10:12:00Z" }] }
```

**The owner approves anything that cannot be undone.** These owner commands reach customers or cannot be undone: `publish`, `update_product` with a new price, `remove_product`, `upsert_promo`, `set_promo_active`, `remove_home_block`, `discard_draft` (when the draft has changes), `create_api_key` and `revoke_api_key`. When an agent calls one under `agentPolicy: "ask"`, nothing changes and the result is `{ ok: false, code: "needs_confirm", plan: [...], challenge: {...} }`. The plan says what would change and who it reaches; for `publish` it includes how many update reports the server has received (telemetry has no device id, so the number of phones is not known). The `challenge` is issued by the server: `id`, the `command`, a SHA-256 `args_hash` of the exact arguments, the `app`, the `requester`, an `expires_at` 10 minutes ahead and an `approval_url` in the admin. `confirm: true` no longer runs anything.

The owner opens the approval URL, signed in to the admin (session cookie), reads the plan and presses Approve or Deny. The owner token, a publish token and an agent API key cannot approve: the route answers 403 `agent_cannot_approve`. Then the agent calls again with the same arguments and `approval: "<challenge id>"`. The server runs the command only if the challenge is approved, unexpired, unused and the arguments hash matches. It marks the challenge used before it runs. Refusals have clear codes: `approval_pending`, `approval_denied`, `approval_expired`, `approval_used`, `approval_mismatch`, `approval_not_found`. When the owner presses Approve or Deny on a challenge that was already decided, the route answers 409 `approval_not_pending`; an unknown id answers 404 `approval_not_found`. Every call that ran is written to the audit log with `approved_by`, `approval_id` and `approved_how` (`admin session`); the owner's decision is its own audit row (command `approval`). A refused call is logged with `"denied": true`. A call that ran under `agentPolicy: "allow"` has none of these fields. Changes to the policy (`set_agent_policy`) are logged with the admin as actor. `approvals_list` in `@shipvo/mcp` shows pending challenges (`challenges`) and held promotes; an agent can read them but never approve them. No owner command sends notifications today.

Owner rules, in `shipvo.json` or (for the control plane) with the `set_agent_policy` command, which only a signed-in owner can run:

```json
{ "agentPolicy": "ask", "agentDeny": ["remove_product"] }
```

- `agentPolicy` is `"ask"` (default: the owner-approval step above), `"deny"` (those commands are refused with code `denied`) or `"allow"` (**agents act without asking**: no approval step; never the default, and only the control plane's own setting can turn it on).
- `agentDeny` lists commands agents may never run, approved or not.
- The `shipvo.json` read by `@shipvo/mcp` (from `PN_APP_DIR` or the current folder) can only make the rules stricter than the control plane's.
- The signed-in admin at `/app/<id>/admin` is not gated: the confirm step is for agents holding the owner token.

## Grading an agent

`end_session` returns what the app actually sent to its backend, not what the agent says it did. `shipvo eval` scores an agent on a task that way: see [Score an agent on an app task](eval.md). Earlier results: [agent-gate-results.md](agent-gate-results.md).

## Listing your app for every agent

A published app is private to your key until you list it. In `shipvo.json`:

```json
{ "listing": { "public": true, "description": "Fishing-supplies shop in Douala: catalogue, cart, mobile money.", "category": "shop" } }
```

Run `shipvo app create` again. After a short review it appears on [shipvo.dev/apps](https://shipvo.dev/apps) and in `list_apps` for every signed-in key, and any agent can `open_app("<id>@latest")`. Opening a public app spends the opener's sandbox minutes, not yours. Set `public` to `false` and run `shipvo app create` to withdraw. Categories: shop, food, travel, finance, health, education, services, tools, games, other.

## Troubleshooting

**`Error [no_session]: no session '…': call open_app first`, or `sessions expire with the phone`.** The phone the session belonged to has closed. Call `open_app` again to start a new one, then use the new session id.

**`Error [no_live_run]: no live shipvo run found … (.shipvo/run.json missing, stale, or for another app)`.** You asked to attach to the phone from `shipvo run`, but none is running for this app. Start `shipvo run android` or `shipvo run ios` in the app folder, keep it open, and try again. Or open a separate phone with `attach: "auto"`. See [Run on a phone](run.md).

**`Error [build_not_supported]`.** The simulator could not load the build you named with `@build:<id>`. Open the app without `@build` to use the published version, or see [Test your own build](test-your-build.md).

**The assistant cannot find a button.** The tree only lists what a person could see and touch (see [What the tree shows](#what-the-tree-shows-and-hides-on-purpose)). Ask the assistant to read the screen again after the app finishes loading, and check that the button has a label.

**Your coding agent does not list the Shipvo tools.** Run `npx shipvo agents setup` in the app folder. It writes the MCP config for each coding agent it finds ([CLI guide](cli.md)). Restart the agent so it reads the new config.

## Next steps

- [Test with an assistant](test-with-an-assistant.md): the same flow in plain words, for founders.
- [Turn a session into a test](#turn-a-session-into-a-test) and [Test your app in CI](testing.md).
- [Score an agent on an app task](eval.md).
- [Run on a phone](run.md): watch the assistant work in your browser.
- [Phone apps](phone-apps.md): Settings, Browser, Store and updates on Shipvo Phone.
