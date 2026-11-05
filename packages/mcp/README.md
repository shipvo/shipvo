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

**Error codes.** A failed call has `isError: true` and `structuredContent: { ok: false, code, error }`. Some failures from other causes (for example a read-only key) have `code: null`; read `error`.

| Code | Meaning | What the agent should do |
| --- | --- | --- |
| `no_session` | The simulator has no session with that id (it expired or was never opened). | Call `list_sessions`, or `open_app` again. |
| `stale_ref` | The ref is not on the current screen, or the screen changed since it was read. | Call `screen` and use a ref from the new tree. |
| `unknown_app` | The app id is not one this server or key can open. | Call `list_apps` and use an id from it. |
| `sim_timeout` | The simulator did not answer in time. The action may have run. | Call `screen` to see where the app is. Do not repeat the action blindly. |
| `needs_confirm` | An owner command that cannot be undone did nothing and returned a plan. | Show the plan to the owner, then call again with `confirm: true`. |
| `bad_url` | `open_url` got a URL the app cannot take. | Fix the URL and call again. |
| `no_url_listener` | The app is not listening for URLs. | Use the app's screens instead. |
| `mock_invalid` | A network mock rule is not valid. | Fix the rule. |

Tools: `list_apps`, `open_app`, `screen`, `tap`, `type`, `scroll`, `back`, `screenshot`, `set_device`, `push_notification`, `notifications`, `open_notification`, `device_log`, `export_test`, `end_session`, `owner_describe`, `owner_command`.

`export_test { session }` is read-only. It turns the taps, typing, scrolls, `back` and `set_device` calls recorded in a session into a `@shipvo/test` script and returns the source. Targets are named by visible text; an ambiguous target becomes a `// TODO` comment, and a password-like field uses `process.env.SHIPVO_TEST_<LABEL>` so the typed value is never in the output. Only sessions opened through this server are recorded; an unknown session returns `no_session`. Steps are dropped when the session ends. `payment.pin` is removed from recorded `set_device` calls. Only labels and roles that look like a password, passcode or PIN are treated as secret; other secret-like fields (card number, token) are exported as typed. `type` with `enter: true` and `scroll` with a `ref` are recorded without the Enter or the ref, so a replay can differ from the session.

**Owner commands that cannot be undone need `confirm: true`.** `owner_command` takes an optional `confirm`. `publish`, price changes, offers, deletes and API keys first return `{ code: "needs_confirm", plan }` and do nothing; call again with the same `args` and `confirm: true` to run. `agentPolicy` (`ask` default, `deny`, `allow`) and `agentDeny` in `shipvo.json` (read from `PN_APP_DIR` or the current folder) can only tighten the control plane's rules. Details: `docs/agents.md`.

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
- **2026-07-28 clients**: `tools/list` and `tools/call` work with no session and no `initialize`. Not done yet: `server/discover`, the `Mcp-Method`/`Mcp-Name` headers, `ttlMs`/`cacheScope` on list results. `tools/list` order is fixed (registration order).
- This package uses `@modelcontextprotocol/sdk` 1.x. Stdio is unchanged.

 Requests without a valid key are refused. The hosted version at `sim.shipvo.dev` will issue keys per account with scopes (test, owner, read).
