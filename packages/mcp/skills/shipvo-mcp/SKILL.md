---
name: shipvo-mcp
description: Drive a React Native app through the @shipvo/mcp server. Use when the project depends on @shipvo/mcp and you need to open the app, read the screen, tap, type, scroll or take a screenshot.
---

# @shipvo/mcp

An MCP server that gives you a headless phone. Start the simulator first: `shipvo sim` (http://localhost:4545).

Add the server to your MCP config:

```json
{ "mcpServers": { "shipvo": { "command": "npx", "args": ["-y", "@shipvo/mcp"] } } }
```

## Drive the app

1. `open_app("<app id>")` returns a session and the first screen.
2. `screen(session)` returns the accessibility tree. Each element has a ref, for example `[ref=e12]`.
3. `tap(session, ref)`, `type(session, ref, text)`, `scroll(session, direction, ref?)`, `back(session)`.
4. `screenshot(session)` returns a PNG.
5. `end_session(session)` when done.

Each action result starts with `Change: none | content changed | new screen | scrolled`, then the screen. Refs are renumbered between screens: read the screen again before you tap.

Wait for an effect instead of sleeping: pass `wait_for: { text: "Cart" }` or `settle: true` to `tap`, `type`, `scroll` or `back`. The result gets `Waited: matched | timed out after <ms> ms`.

## When a call fails

A failed call has `isError: true` and `structuredContent: { ok: false, code, error }`. Read `code`, then `error`. On `sim_timeout` call `screen`: the action may have run.

Use `set_device` for location, permissions, biometrics, payment and network. The full tool list is in the package README.
