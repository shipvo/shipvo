# @shipvo/sim

Runs a Shipvo app in a phone-sized headless browser (Playwright, Pixel 5 viewport) and gives agents what a person with a screen reader gets: the accessibility tree with refs, tap/type/scroll/back, screenshots, system permission sheets, and a simulated device (camera, location, biometrics, payments, notifications, share, network) whose state the agent sets.

```bash
shipvo sim                  # in an app created with `shipvo init`: builds the web bundle and serves it on :4545
npx shipvo-sim --dist ./sim-dist --app myshop
```

HTTP API (used by `@shipvo/mcp`): `POST /session {session, app, seed_cart, dark, device}`, `POST /act {session, action, ...}` with actions `screen tap type scroll back screenshot set_device push_notification notifications open_notification device_log device_reset`, and a per-session mock control plane at `/s/<session>/...` that records the orders the app posts (`GET /s/<session>/orders`).

`POST /session` with `root_mount: true` is for apps with a router that reads the address, such as expo-router: the app is still served under `/app/`, and it sees `/` as its address, `/feed/1` for `/app/feed/1`. A page load of an address the simulator does not know is sent to the app. `--host 127.0.0.1` makes the simulator listen on this machine only. The simulator serves files from the build folder only: a path that leaves it, in any spelling or through a link, is not found. A local build made with a base path (Expo `experiments.baseUrl`) is served under that path too. A session opens once the app has loaded and waits up to `SHIPVO_SIM_NET_QUIET_MS` (default 5000) for the network to go quiet. The `errors` action also lists scripts that did not load. `POST /session` with `a2ui: true` opens a session that shows [A2UI](https://a2ui.org/) version 1.0 surfaces instead of an app build; `a2ui_messages` are applied first. The `a2ui_send` action applies more messages and `a2ui_actions` returns what the screen sent to the agent. See `docs/a2ui.md`. `POST /session` with `model` (for example `"iPhone 16 Pro"` or `"Galaxy S24"`) makes the session that phone: its screen size, pixel ratio, user agent and platform. An unknown name answers `bad_model` with the list of models. `screenshot` with `frame: true` saves the whole phone: the app in its Android or iOS frame with the status bar. `POST /session` with `fit_frame: true` gives the app the app area of its frame (412x855 on Android, 393x764 on iOS). `record_start` and `record_stop` record the framed phone to an MP4 in the session folder; `record_stop` returns `{ path, duration_s, frames }` and needs ffmpeg.

`app` can be `myshop` (the local build), `myshop@r13` (a published release) or `myshop@latest`.
