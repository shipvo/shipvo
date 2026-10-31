# @shipvo/sim

Runs a Shipvo app in a phone-sized headless browser (Playwright, Pixel 5 viewport) and gives agents what a person with a screen reader gets: the accessibility tree with refs, tap/type/scroll/back, screenshots, system permission sheets, and a simulated device (camera, location, biometrics, payments, notifications, share, network) whose state the agent sets.

```bash
shipvo sim                  # in an app created with `shipvo init`: builds the web bundle and serves it on :4545
npx shipvo-sim --dist ./sim-dist --app myshop
```

HTTP API (used by `@shipvo/mcp`): `POST /session {session, app, seed_cart, dark, device}`, `POST /act {session, action, ...}` with actions `screen tap type scroll back screenshot set_device push_notification notifications open_notification device_log device_reset`, and a per-session mock control plane at `/s/<session>/...` that records the orders the app posts (`GET /s/<session>/orders`).

`app` can be `myshop` (the local build), `myshop@r13` (a published release) or `myshop@latest`.
