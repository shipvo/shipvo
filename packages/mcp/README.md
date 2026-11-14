# @shipvo/mcp

Lets AI agents (Claude, Cursor, Claude Code, PiPilot…) **use a Shipvo app without a phone**: open it, read the screen as an accessibility tree, tap, type, scroll, go back, take screenshots, and read what the app sent to its backend. Plus the owner API: change content, prices and offers, and publish to every phone.

```json
{ "mcpServers": { "shipvo": {
  "command": "npx", "args": ["-y", "@shipvo/mcp"],
  "env": { "PN_SIM": "http://localhost:4545", "PN_OWNER_TOKEN": "…optional…" } } } }
```

Start the simulator first (`shipvo sim` in the app). The server asks the simulator which app it serves, so `open_app("<your app id>")` works; set `PN_APPS` (JSON) to override. If the simulator cannot be reached, only the sample app opens. The hosted version needs no local setup: `{ "url": "https://<host>/mcp/<key>" }`.

Each `tap`, `type`, `scroll` and `back` result starts with a line `Change: none | content changed | new screen | scrolled`, then the screen. `type` also adds `Value of <ref>: "..."`. When the change is `content changed`, the result lists only the lines that changed: `+` added, `-` removed and `~` for an element whose text changed (`~ switch "Dark theme" [ref=e12] → switch "Dark theme" [checked] [ref=e12]`). Refs are the same as on the full screen. Pass `compact: false` for the whole screen, or set `SHIPVO_MCP_FULL_SCREEN=1` on the server to get whole screens every time.

`tap` takes a path: `tap(session, ref: "e4", then: ["Settings", "Dark theme"])` taps `e4`, then the element named Settings on the screen that follows, then Dark theme, in one call. Each step is a visible name or a ref. The path stops at the first step that is not on the screen and answers `path_step_not_found` with the screen it stopped on.

`tap`, `type`, `scroll` and `back` also take optional fields to wait for the effect instead of sleeping:

- `wait_for`: `{ ref }`, `{ text }` or `{ role, name }` that must appear on the screen, or add `gone: true` to wait for it to disappear. `text` and `name` match as substrings.
- `settle: true`: wait until the screen stops changing (two reads 100 ms apart that are equal, ignoring ref numbers).
- `timeout_ms`: the most time `wait_for` and `settle` may take together (default 2000, at most 30000). One read of the simulator can itself take up to the time limit below, so this is not a hard cap on the call.

Refs are renumbered between screens, so with `gone: true` prefer `text` or `role` + `name` over `ref`.

The result gets a line `Waited: matched | timed out after <ms> ms` and `structuredContent.waited = { matched, ms }`. On a timeout the action still happened: the result is the latest screen, it is not an error, and the action's own outcome (such as `delivered`) is unchanged. Without these fields the result is the same as before.

**Time limit.** Every call to the simulator stops after 30 s; set `SHIPVO_SIM_TIMEOUT_MS` to change it. A call that gets no answer returns an error result (`isError: true`, code `sim_timeout`, also in `structuredContent`). The action may still have run and the session may still be alive, so call `screen` to see where it is. Timed-out actions are not retried.

**Error codes.** A failed call has `isError: true` and `structuredContent: { ok: false, code, error }`. Some failures from other causes (for example a read-only key) have `code: null`; read `error`.

| Code | Meaning | What the agent should do |
| --- | --- | --- |
| `no_session` | The simulator has no session with that id (it expired or was never opened). | Call `list_sessions`, or `open_app` again. |
| `stale_ref` | The ref is not on the current screen, or the screen changed since it was read. | Call `screen` and use a ref from the new tree. |
| `unknown_app` | The app id is not one this server or key can open. | Call `list_apps` and use an id from it. |
| `sim_timeout` | The simulator did not answer in time. The action may have run. | Call `screen` to see where the app is. Do not repeat the action blindly. |
| `needs_confirm` | An owner command that cannot be undone did nothing and returned a plan and a one-time `challenge`. | Show the plan to the owner and ask them to approve it at `challenge.approval_url` in the admin. Then call again with the same args and `approval: <challenge id>`. `confirm: true` does nothing. |
| `bad_model` | `open_app` got a `model` the simulator does not know. | Call `phone_models` and use a name from it. |
| `bad_url` | `open_url` got a URL the app cannot take. | Fix the URL and call again. |
| `no_url_listener` | The app is not listening for URLs. | Use the app's screens instead. |
| `phone_locked` | The phone is locked, so tap, type, scroll and back were not sent. | Call `unlock`, then try again. |
| `already_locked` | `lock` was called on a locked phone. | Call `unlock` if you want to use the app. |
| `not_locked` | `unlock` was called on a phone that is not locked. | Carry on; nothing to do. |
| `app_not_foreground` | The home screen or app switcher is showing, so tap, type, scroll, back, `open_url` and `open_notification` were not sent. | Call `resume_app`. |
| `recents_not_open` | `kill_app` was called without the app switcher open. | Call `open_recents` first. |
| `mock_invalid` | A network mock rule is not valid. | Fix the rule. |
| `no_room` | `room_log` or `room_note` named a room with no open session. | Open a session with that `room`, then call again. |
| `note_too_long` | A `room_note` text is over 500 characters. | Shorten the note. |
| `bad_note` | A `room_note` text is empty. | Send 1 to 500 characters. |
| `bad_cursor` | `since` is not a cursor from an earlier `room_log` or `room_note`. | Leave `since` out to read the whole log. |

Tools: `list_apps`, `phone_models`, `open_app`, `a2ui_open`, `a2ui_send`, `a2ui_actions`, `upload_build` (see [docs/test-your-build.md](../../docs/test-your-build.md)), `publish_preview`, `job_status` (slow tools return `{ status: "running", job }` after `wait_ms`; poll with `job_status`, see [docs/cli.md](../../docs/cli.md)), `attach_session`, `screen`, `tap`, `type`, `scroll`, `back`, `screenshot`, `set_device`, `push_notification`, `notifications`, `open_notification`, `device_log`, `export_test`, `end_session`, `owner_describe`, `owner_command`, `room_log`, `room_note`, `approvals_list`, `approval_approve` (both need an owner token, and the MCP agent counts as an agent: it cannot approve an agent's hold).

`export_test { session }` is read-only. It turns the taps, typing, scrolls, `back` and `set_device` calls recorded in a session into a `@shipvo/test` script and returns the source. Targets are named by visible text; an ambiguous target becomes a `// TODO` comment, and a password-like field uses `process.env.SHIPVO_TEST_<LABEL>` so the typed value is never in the output. Only sessions opened through this server are recorded; an unknown session returns `no_session`. Steps are dropped when the session ends. `payment.pin` is removed from recorded `set_device` calls. Only labels and roles that look like a password, passcode or PIN are treated as secret; other secret-like fields (card number, token) are exported as typed. `type` with `enter: true` and `scroll` with a `ref` are recorded without the Enter or the ref, so a replay can differ from the session.

## Phone models and framed screenshots

`phone_models` lists the phones a headless session can be, each with its platform, screen size in CSS pixels and pixel ratio, and the default for android and ios. Pass a name to `open_app` as `model` (for example `"iPhone 16 Pro"` or `"Galaxy S24"`) and the session is that phone: its screen size, pixel ratio, user agent and platform. `model` applies to headless sessions; a live `shipvo run` phone is attached as it is.

`a2ui_open` draws A2UI 1.0 messages as a phone screen with no app, `a2ui_send` changes the screen and `a2ui_actions` returns the action messages a person sent. See [docs/a2ui.md](../../docs/a2ui.md).

`screenshot` takes `frame: true` to return the whole phone, the app inside its Android or iPhone frame with the status bar, for showing a person. Without it the result is the app's screen alone.

## Record a demo video

`record_start`, `record_marker` and `record_stop` write an MP4 of the phone to `.shipvo/recordings/`. `record_stop` takes `music: true` (a ducked music bed and a `.credits.json`) and `narration` (a path to a wav). It needs ffmpeg and `playwright`. Music works only from a repo checkout, or when `SHIPVO_BGMUSIC` points at `scripts/video/bgmusic.py`; otherwise `record_stop` returns `music_unavailable` (and `music_failed` if the mix fails). A runnable example is in [`docs/record-a-demo-video.md`](../../docs/record-a-demo-video.md).

**Owner commands that cannot be undone need the owner's approval.** `publish`, price changes, offers, deletes and API keys first return `{ code: "needs_confirm", plan, challenge }` and change nothing. The owner approves the challenge in the admin (an agent cannot), then `owner_command` is called again with the same args and `approval: "<challenge id>"`. An approval works once, for 10 minutes, for exactly those arguments. `approvals_list` shows pending challenges. With `agentPolicy: "allow"` agents act without asking.

Native features work with no phone: the simulated device (see `@shipvo/device`) shows permission dialogs, the camera, the fingerprint prompt, payment prompts, notification banners and the share sheet as real dialogs in the tree; `set_device` decides what the phone has (location, a barcode in view, whether the fingerprint matches, whether a payment is approved, network off).

The simulator shows only what a phone would: a horizontal rail lists the visible items, so agents swipe it (`scroll right` with the rail's ref) exactly as on a device. Measured against a real Android emulator and iPhone simulator, see `docs/parity-results.md`.

## Did the action land?

`tap`, `type`, `scroll` and `back` return `structuredContent` next to the usual text:

- `delivery`: `"delivered"` or `"not_delivered"`.
- On `not_delivered` (the result is also `isError`): `reason` is `stale_ref`, `not_visible`, `disabled` or `covered`, and `safe_to_retry` is `true` because nothing reached the app. Take a new `screen`, then retry.
- `type` also returns `value`, the text the field holds after typing.

`code`, `error` and the text result are unchanged. Other failures (for example `sim_timeout`) carry no `delivery` field: the action may have run, so call `screen` first.

## Remote (Streamable HTTP)

Run the server where the simulator runs and put it behind HTTPS (a Cloudflare Tunnel is enough):

```
PN_API_KEYS="key-for-claude,key-for-pipilot" shipvo-mcp --http 8787
```

Clients connect with a URL instead of a command:

```json
{ "mcpServers": { "shipvo": { "url": "https://sim.shipvo.dev/mcp", "headers": { "Authorization": "Bearer key-for-claude" } } } }
```

The HTTP endpoint is stateless. There is no protocol session: each POST is handled on its own, and the `x-shipvo-*` scope headers are read per request, so a scope never carries over to another request. `GET` and `DELETE` on `/mcp` answer 405. Phones are separate: each `open_app` gets its own phone, and you pass its `session` as a tool argument.

### Protocol versions

- **2025-era clients** (`initialize`, then calls, with or without `Mcp-Session-Id`): work. `initialize` is answered, no session id is issued, and any `Mcp-Session-Id` a client sends is ignored.
- **2026-07-28 clients**: `tools/list` and `tools/call` work with no session and no `initialize`. `server/discover` is answered (supported versions, tools capability, server info). A request counts as 2026-era if it calls `server/discover`, sends `Mcp-Method`, or names a 2026 protocol version in `params._meta`; those must carry `Mcp-Method` (and `Mcp-Name` for `tools/call`, `prompts/get`, `resources/read`) matching the body, or get a 400 JSON-RPC error. Requests with no 2026 marker are not checked. Header mismatches return `-32020`; naming a protocol version we do not support returns `-32022`. 2026-era results carry `resultType: "complete"`, and `tools/list` results also carry `ttlMs` and `cacheScope: "private"` (the list depends on the per-request scope headers). 2025-era responses have none of these. `tools/list` is sorted by tool name on stdio and HTTP.
- This package uses `@modelcontextprotocol/sdk` 1.x (the TypeScript SDK v2 is not stable on npm yet; 1.32.2 is `latest`). Tested by `test/http-stateless.test.ts`: discover without `initialize`, header/body mismatch, scope per request, 2025-era `initialize` clients. Stdio is unchanged.

 Requests without a valid key are refused. The hosted version at `sim.shipvo.dev` will issue keys per account with scopes (test, owner, read).

## Trace context

If your agent sends a W3C `traceparent` in the `_meta` of a `tools/call`, Shipvo records its trace id with that call in the session's tool-call log and echoes `traceparent` in the result `_meta`. A malformed value is ignored. `tracestate` and `baggage` are never read, stored or logged, and nothing is forwarded to a third party.

```json
{ "method": "tools/call", "params": { "name": "tap", "arguments": { "session": "s1", "ref": "e3" },
  "_meta": { "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" } } }
```

`export_test` returns the log in `structuredContent` (`traceIds` and `calls`) and puts a `// trace id:` comment at the top of the script. `shipvo eval` run records (`run.json`) list the `traceIds` the agent sent, and each step in `steps.jsonl` carries its `traceId`.
