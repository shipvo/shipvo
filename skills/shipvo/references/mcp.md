# MCP tools

`list_apps`, `list_sessions`, `phone_models`, `open_app(app, session?, model?, seed_cart?, dark?, attach?)`, `attach_session(app?, session?)`, `screen`, `tap`, `type`, `scroll`, `back`, `screenshot`, `set_device`, `device_reset`, `push_notification`, `notifications`, `open_notification`, `device_log`, `end_session`, `record_start`, `record_marker`, `record_stop`, `owner_describe`, `owner_command`.

- `phone_models` lists the phones a headless session can be. `open_app(app, model: "iPhone 16 Pro")` opens the app as that phone: its screen size, pixel ratio, user agent and platform. An unknown name answers `bad_model`.
- `screenshot(session, frame: true)` returns the whole phone in its Android or iPhone frame with the status bar, for showing a person. Without `frame` it returns the app's screen alone.
- A2UI: `a2ui_open(messages, session?, model?)` draws A2UI 1.0 messages as a phone screen with no app and returns the session and the tree; it lists each refused message with its reason. `a2ui_send(session, messages)` changes the screen. `a2ui_actions(session, since?)` returns the `action` messages from buttons a person pressed. `screen`, `tap`, `type` and `screenshot` work on the session.
- After `tap`, `type`, `scroll` and `back`, a `content changed` result lists only the changed lines (`+` added, `-` removed, `~` changed), with the same refs as the full screen. Call `screen` when you need the whole tree, or pass `compact: false`.
- Tap a known path in one call: `tap(session, ref, then: ["Settings", "Dark theme"])`. Each step is a visible name or a ref. Use it whenever you already know the next taps; it saves a call per step.
- If a tap answers `approval_needed`, nothing was tapped: ask the person in chat, and only after a yes call `tap` again with `approved: true`. Never set `approved` on your own. `tap_declined` means the person said no: stop there.
- Passwords and one-time codes: `type(session, ref, text, secret: true)`. Password fields are treated as secret without it. The result does not echo the text.
- `myshop` is the local build, `myshop@r13` a published release, `myshop@latest` the newest.
- Attached sessions (to a live `shipvo run` phone) support screen, tap, type, scroll and back only.
- Every simulated device event is logged with `simulated: true`. Never present a simulated payment or fingerprint as real.
- Hosted: `shipvo login` gets a key for https://sim.shipvo.dev/mcp.
- Full guide: `docs/agents.md` in the Shipvo repo.
