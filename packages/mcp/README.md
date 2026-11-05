# @shipvo/mcp

Lets AI agents (Claude, Cursor, Claude Code, PiPilot…) **use a Shipvo app without a phone**: open it, read the screen as an accessibility tree, tap, type, scroll, go back, take screenshots, and read what the app sent to its backend. Plus the owner API: change content, prices and offers, and publish to every phone.

```json
{ "mcpServers": { "shipvo": {
  "command": "npx", "args": ["-y", "@shipvo/mcp"],
  "env": { "PN_SIM": "http://localhost:4545", "PN_OWNER_TOKEN": "…optional…" } } } }
```

Start the simulator first (`shipvo sim` in the app). The server asks the simulator which app it serves, so `open_app("<your app id>")` works; set `PN_APPS` (JSON) to override. If the simulator cannot be reached, only the sample app opens. The hosted version needs no local setup: `{ "url": "https://<host>/mcp/<key>" }`.

Each `tap`, `type`, `scroll` and `back` result starts with a line `Change: none | content changed | new screen | scrolled`, then the screen. `type` also adds `Value of <ref>: "..."`. Pass `compact: true` to get only the added (`+`) and removed (`-`) lines when the change is `content changed`; refs match the full screen. If the server has no earlier screen for the session (for example after a reconnect), the first line is `Change: unknown`. The `content changed` / `new screen` split is a heuristic (under half the lines kept means a new screen), so on a short screen one change can read as `new screen`.

**Time limit.** Every call to the simulator stops after 30 s; set `SHIPVO_SIM_TIMEOUT_MS` to change it. A call that gets no answer returns an error result (`isError: true`, code `sim_timeout`, also in `structuredContent`). The action may still have run and the session may still be alive, so call `screen` to see where it is. Timed-out actions are not retried.

Tools: `list_apps`, `open_app`, `screen`, `tap`, `type`, `scroll`, `back`, `screenshot`, `set_device`, `push_notification`, `notifications`, `open_notification`, `device_log`, `end_session`, `owner_describe`, `owner_command`.

Native features work with no phone: the simulated device (see `@shipvo/device`) shows permission dialogs, the camera, the fingerprint prompt, payment prompts, notification banners and the share sheet as real dialogs in the tree; `set_device` decides what the phone has (location, a barcode in view, whether the fingerprint matches, whether a payment is approved, network off).

The simulator shows only what a phone would: a horizontal rail lists the visible items, so agents swipe it (`scroll right` with the rail's ref) exactly as on a device. Measured against a real Android emulator and iPhone simulator, see `docs/parity-results.md`.

## Error codes

A failed tool call has `isError: true`. The text starts with `Error [code]: message`, and `structuredContent` is `{ ok: false, code, error }`. `code` is always a string. One test (`test/error-codes.test.ts`) checks this for every session tool.

| Code | Meaning | What the agent should do |
| --- | --- | --- |
| `no_session` | The simulator has no session with that id (it expired or was never opened). | Call `open_app` again. |
| `stale_ref` | The ref is from an earlier screen, or no longer exists. | Call `screen`, then use a ref from it. |
| `not_a_text_field` | `type` was given a ref that is not a text field. | Pick a `textbox` ref from `screen`. |
| `no_back_button` | `back` was called on a screen with no Back button. | Use `screen` and tap another control. |
| `no_such_notification` | `open_notification` got an id that is not in the shade. | Call `notifications` and use an id from it. |
| `bad_url` | `open_url` got an empty or non-string url. | Pass a url such as `myapp://item/3`. |
| `no_url_listener` | The app has no URL listener. | The app must register one with `onUrl` from `@shipvo/device`. |
| `unknown_action` | The simulator does not know the action. | Use one of the documented tools. |
| `unknown_app` | `open_app` got an app this server or key does not open. | Call `list_apps` and use an id from it. |
| `bad_app_spec` | The app spec is not `id`, `id@rN` or `id@latest`. | Fix the spec. |
| `no_web_artifact` | The release has no published web build to simulate. | Open the local build, or publish first. |
| `read_only_key` | The key is read-only and cannot open sessions. | Use a key with test scope. |
| `no_screenshot` | The simulator returned no image. | Use `screen` instead. |
| `sim_timeout` | The simulator did not answer in time. The action may have run. | Call `screen` to see where the session is. Do not retry blindly. |
| `sim_unreachable` | The server could not connect to the simulator. | Check that the simulator is running. |
| `sim_error` | The simulator failed without a more specific code (including a non-200 reply). | Call `screen`; if it keeps failing, restart the simulator. |

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
- **2026-07-28 clients**: `tools/list` and `tools/call` work with no session and no `initialize`. Not done yet: `server/discover`, the `Mcp-Method`/`Mcp-Name` headers, `ttlMs`/`cacheScope` on list results. `tools/list` order is fixed (registration order).
- This package uses `@modelcontextprotocol/sdk` 1.x. Stdio is unchanged.

 Requests without a valid key are refused. The hosted version at `sim.shipvo.dev` will issue keys per account with scopes (test, owner, read).
