# @shipvo/mcp

Lets AI agents (Claude, Cursor, Claude Code, PiPilot…) **use a Shipvo app without a phone**: open it, read the screen as an accessibility tree, tap, type, scroll, go back, take screenshots, and read what the app sent to its backend. Plus the owner API: change content, prices and offers, and publish to every phone.

```json
{ "mcpServers": { "shipvo": {
  "command": "npx", "args": ["-y", "@shipvo/mcp"],
  "env": { "PN_SIM": "http://localhost:4545", "PN_OWNER_TOKEN": "…optional…" } } } }
```

Start the simulator first (`node sim/server.mjs` in the app, or `shipvo sim` soon). The hosted version at `sim.shipvo.dev` needs no local setup.

Tools: `list_apps`, `open_app`, `screen`, `tap`, `type`, `scroll`, `back`, `screenshot`, `set_device`, `push_notification`, `device_log`, `end_session`, `owner_describe`, `owner_command`.

Native features work with no phone: the simulated device (see `@shipvo/device`) shows permission dialogs, the camera, the fingerprint prompt, payment prompts, notification banners and the share sheet as real dialogs in the tree; `set_device` decides what the phone has (location, a barcode in view, whether the fingerprint matches, whether a payment is approved, network off).

The simulator shows only what a phone would: a horizontal rail lists the visible items, so agents swipe it (`scroll right` with the rail's ref) exactly as on a device. Measured against a real Android emulator and iPhone simulator, see `docs/parity-results.md`.

## Remote (Streamable HTTP)

Run the server where the simulator runs and put it behind HTTPS (a Cloudflare Tunnel is enough):

```
PN_API_KEYS="key-for-claude,key-for-pipilot" shipvo-mcp --http 8787
```

Clients connect with a URL instead of a command:

```json
{ "mcpServers": { "shipvo": { "url": "https://sim.shipvo.dev/mcp", "headers": { "Authorization": "Bearer key-for-claude" } } } }
```

Each client connection gets its own MCP session; each `open_app` gets its own phone. Requests without a valid key are refused. The hosted version at `sim.shipvo.dev` will issue keys per account with scopes (test, owner, read).
