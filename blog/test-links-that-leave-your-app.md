---
title: Test the links that leave your app: payment pages, privacy policies and deep links
date: 2026-11-07
order: 2
author: Shipvo team
tags: Testing, Guides
seo_title: Test deep links and in-app web pages in React Native
summary: Test what happens when your app opens a web page and the page links back. The Shipvo Phone Browser on Android and iOS, with real tool calls and tests.
---

Most app tests stop at the edge of the app. Tap "Pay", and the test ends because a web page took over.

That edge is where real bugs live. The payment page opens, the customer pays, and the link back to your app does nothing. The privacy policy link opens a page with no way back. A deep link like `tide://item/3` lands on the home screen instead of item 3.

This post shows how to test the whole round trip, on Android and iOS, with the Browser app on Shipvo Phone. No emulator is needed, and your assistant can drive it for you.

## Why links that leave your app break

A link out of your app hands control to a different program: the phone's browser. Your app is paused, and your test tools usually cannot see the page. So teams skip the check and find the bug in production.

Three things tend to go wrong:

- The app calls `Linking.openURL` with a bad address, and nothing visible happens.
- The web page works, but its "Open the app" link uses a scheme the app does not handle.
- The app is not listening for the URL when it comes back.

All three can be tested if the phone has a real browser next to your app.

## The Browser app on Shipvo Phone

Shipvo Phone has its own Browser app, separate from your app. It runs a real Chromium and shows up in the phone frame on Android and iOS alike. See it with [`shipvo run`](/docs/run/) or let your assistant drive it over MCP.

When your app opens an `http(s)` link, the phone opens it in the Browser, as a real phone would. A link from a web page to your app's own scheme goes back to the app. The [phone apps guide](/docs/phone-apps/) lists every tool.

The Browser tools are:

| Tool | What it does |
| --- | --- |
| `browser_open` | Opens a URL and returns a snapshot with refs |
| `browser_snapshot` | Reads the current page as a tree |
| `browser_click`, `browser_type` | Act on a ref from the snapshot |
| `browser_wait_for` | Waits for text to appear or go away |
| `browser_back`, `browser_scroll` | Navigate the page |
| `browser_tabs`, `browser_close_tab` | Manage tabs |
| `browser_screenshot` | Returns a PNG |

## Test the trip out and back

Ask your assistant, in plain words:

> Open the shop, add the fishing line to the cart, tap Pay, and check that the payment page opens. Then tap the link back to the app and tell me which screen you land on.

Behind that sentence, the calls look like this (a sketch of the flow, not captured output):

```text
open_app tide                      -> session "tide-abc"
tap { session, ref: "Pay" }        -> app calls Linking.openURL(...)
browser_snapshot { session }       -> title, tree with link "Open the app" [ref=e7]
browser_click { session, ref: "e7" }
screen { session }                 -> the app shows the item screen
device_log { session }             -> browser_navigation, deep_link
```

`device_log` records every step, so a test can check that the page opened and that the deep link came back. Entries are labelled `simulated`, so you never mistake them for a real phone.

## Deep links: assert the right screen

You can also skip the web page and send the link straight to the app. In a typed test, with `@shipvo/test`:

```ts
await phone.openUrl("tide://item/3");
// then assert the item screen is showing
```

The app must listen with `onUrl` from `@shipvo/device`. If it does not, `openUrl` throws a `PhoneError` with the code `no_url_listener`. That error is the point: a missing listener fails loudly in a test instead of silently on a customer's phone. The [testing guide](/docs/testing/) has the full list of calls.

## What we ran

These tests are in `packages/sim/browser-app.test.mjs` and `packages/sim/open-url.test.mjs`. On 7 November 2026 we ran both files in this repo: 14 tests, 14 passed. They cover:

- `Linking.openURL` from the app opens the Browser, and the app does not get the web link.
- A deep link clicked on a web page opens the app with `tide://item/3`, and `device_log` records `deep_link`.
- Two links opened at the same time share one browser.
- Tabs can be listed and closed, and `browser_wait_for` finds text or returns `timeout`.
- A declared scheme resolves to its app, and bad input gives typed errors: `bad_url`, `no_session`, `no_url_listener`.

You can run them yourself:

```bash
cd packages/sim
node --test browser-app.test.mjs open-url.test.mjs
```

## Page text is data, not instructions

If an AI assistant reads a web page, the page can say anything, including "ignore your instructions". Shipvo marks every Browser snapshot with `source: "web"`, so your assistant knows the text came from the page. Treat it as data.

The Browser also refuses private addresses by default: `localhost`, `10.x`, `192.168.x` and `.internal` fail with `host_not_allowed`. This stops a page from reaching into your network. When you need your own dev server, allow only that host:

```text
browser_open { session, url: "http://my-dev-box.local:3000", allow_hosts: ["my-dev-box.local"] }
```

If the app calls `openUrl` and the Browser refuses the page, the call returns `false` and `device_log` records `browser_open_refused`. Always `await` it and handle `false`.

## Try it

1. Run `npx shipvo run android` or `npx shipvo run ios` in your app folder. The [run guide](/docs/run/) has the details.
2. Ask your assistant to open every link in your app and report where each one lands. The [assistant tutorial](/docs/test-with-an-assistant/) shows how to connect it.
3. Turn the checks that matter into typed tests with `export_test`.

Related reading: [Test dark mode, large text and right-to-left](/blog/test-dark-mode-large-text-and-rtl-in-react-native/) covers the Settings app on the same phone, and [The permission you never test](/blog/the-permission-you-never-test/) covers camera, location and payment.

For the rest of the phone, read [Test your app on a phone that has a Store, a Browser and other apps](/blog/test-an-app-on-a-phone-with-a-store-and-other-apps/).
