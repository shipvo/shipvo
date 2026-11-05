# @shipvo/sim

Runs a Shipvo app in a phone-sized headless browser (Playwright, Pixel 5 viewport) and gives agents what a person with a screen reader gets: the accessibility tree with refs, tap/type/scroll/back, screenshots, system permission sheets, and a simulated device (camera, location, biometrics, payments, notifications, share, network) whose state the agent sets.

```bash
shipvo sim                  # in an app created with `shipvo init`: builds the web bundle and serves it on :4545
npx shipvo-sim --dist ./sim-dist --app myshop
```

HTTP API (used by `@shipvo/mcp`): `POST /session {session, app, seed_cart, dark, device}`, `POST /act {session, action, ...}` with actions `screen tap type scroll back screenshot set_device push_notification notifications open_notification device_log device_reset`, and a per-session mock control plane at `/s/<session>/...` that records the orders the app posts (`GET /s/<session>/orders`).

`POST /session` also takes `platform` (`android` or `ios`) and `allow_hosts` for the Browser app. `POST /end {session}` closes a session, including the Browser app's Chromium context; starting a session with an existing id does the same to the old one.

**Browser app.** The actions `browser_open browser_tabs browser_close_tab browser_snapshot browser_click browser_type browser_scroll browser_back browser_screenshot browser_wait_for` drive a real Chromium page per phone, started on first use. The result has `web` (marked `source: "web"`, untrusted) and `screen` (JSON text; a screenshot shows only its size, the PNG is in `web.data`). `allow_hosts` is checked on page navigations and redirects only; images, scripts and iframes are not restricted, so it is not network isolation. Errors:

| Code | Meaning |
| --- | --- |
| `no_tab` | No page is open: call `browser_open` first. |
| `bad_url` | Not an http or https URL. (`open_url` also uses it for an empty URL.) |
| `host_not_allowed` | The host is outside `allow_hosts`. |
| `stale_ref` | The ref is gone from the page: take a new `browser_snapshot`. |

`app` can be `myshop` (the local build), `myshop@r13` (a published release) or `myshop@latest`.
