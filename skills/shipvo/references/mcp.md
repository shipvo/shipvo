# MCP tools

`list_apps`, `list_sessions`, `phone_models`, `open_app(app, session?, model?, seed_cart?, dark?, attach?)`, `attach_session(app?, session?)`, `screen`, `tap`, `type`, `scroll`, `back`, `screenshot`, `set_device`, `device_reset`, `push_notification`, `notifications`, `open_notification`, `device_log`, `end_session`, `record_start`, `record_marker`, `record_stop`, `owner_describe`, `owner_command`.

- `phone_models` lists the phones a headless session can be. `open_app(app, model: "iPhone 16 Pro")` opens the app as that phone: its screen size, pixel ratio, user agent and platform. An unknown name answers `bad_model`.
- `screenshot(session, frame: true)` returns the whole phone in its Android or iPhone frame with the status bar, for showing a person. Without `frame` it returns the app's screen alone.
- `myshop` is the local build, `myshop@r13` a published release, `myshop@latest` the newest.
- Attached sessions (to a live `shipvo run` phone) support screen, tap, type, scroll and back only.
- Every simulated device event is logged with `simulated: true`. Never present a simulated payment or fingerprint as real.
- Hosted: `shipvo login` gets a key for https://sim.shipvo.dev/mcp.
- Full guide: `docs/agents.md` in the Shipvo repo.
