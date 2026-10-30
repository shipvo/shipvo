# @liveo/mcp

Lets AI agents (Claude, Cursor, Claude Code, PiPilot…) **use a Liveo app without a phone**: open it, read the screen as an accessibility tree, tap, type, scroll, go back, take screenshots, and read what the app sent to its backend. Plus the owner API: change content, prices and offers, and publish to every phone.

```json
{ "mcpServers": { "liveo": {
  "command": "npx", "args": ["-y", "@liveo/mcp"],
  "env": { "PN_SIM": "http://localhost:4545", "PN_OWNER_TOKEN": "…optional…" } } } }
```

Start the simulator first (`node sim/server.mjs` in the app, or `liveo sim` soon). The hosted version at `sim.liveo.dev` needs no local setup.

Tools: `list_apps`, `open_app`, `screen`, `tap`, `type`, `scroll`, `back`, `screenshot`, `set_device`, `push_notification`, `device_log`, `end_session`, `owner_describe`, `owner_command`.

Native features work with no phone: the simulated device (see `@liveo/device`) shows permission dialogs, the camera, the fingerprint prompt, payment prompts, notification banners and the share sheet as real dialogs in the tree; `set_device` decides what the phone has (location, a barcode in view, whether the fingerprint matches, whether a payment is approved, network off).

The simulator shows only what a phone would: a horizontal rail lists the visible items, so agents swipe it (`scroll right` with the rail's ref) exactly as on a device. Measured against a real Android emulator and iPhone simulator, see `docs/parity-results.md`.
