# MCP tools

`list_apps`, `list_sessions`, `open_app(app, session?, seed_cart?, dark?, attach?)`, `attach_session(app?, session?)`, `screen`, `tap`, `type`, `scroll`, `back`, `screenshot`, `set_device`, `device_reset`, `push_notification`, `notifications`, `open_notification`, `device_log`, `end_session`, `record_start`, `record_marker`, `record_stop`, `owner_describe`, `owner_command`.

- `myshop` is the local build, `myshop@r13` a published release, `myshop@latest` the newest.
- Attached sessions (to a live `shipvo run` phone) support screen, tap, type, scroll and back only.
- Every simulated device event is logged with `simulated: true`. Never present a simulated payment or fingerprint as real.
- Hosted: `shipvo login` gets a key for https://sim.shipvo.dev/mcp.
- Full guide: `docs/agents.md` in the Shipvo repo.
