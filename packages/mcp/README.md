# @purenative/mcp

Lets AI agents (Claude, Cursor, Claude Code, PiPilot…) **use a PureNative app without a phone**: open it, read the screen as an accessibility tree, tap, type, scroll, go back, take screenshots, and read what the app sent to its backend. Plus the owner API: change content, prices and offers, and publish to every phone.

```json
{ "mcpServers": { "purenative": {
  "command": "npx", "args": ["-y", "@purenative/mcp"],
  "env": { "PN_SIM": "http://localhost:4545", "PN_OWNER_TOKEN": "…optional…" } } } }
```

Start the simulator first (`node sim/server.mjs` in the app, or `purenative sim` soon). The hosted version at `sim.purenative.dev` needs no local setup.

Tools: `list_apps`, `open_app`, `screen`, `tap`, `type`, `scroll`, `back`, `screenshot`, `end_session`, `owner_describe`, `owner_command`.

The simulator shows only what a phone would: a horizontal rail lists the visible items, so agents swipe it (`scroll right` with the rail's ref) exactly as on a device. Measured against a real Android emulator and iPhone simulator, see `docs/parity-results.md`.
