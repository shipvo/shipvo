---
title: See your React Native app on a phone in your browser, with one command
date: 2026-11-06
order: 1
author: Shipvo team
tags: Guides
seo_title: Run a React Native app in the browser as a phone
summary: See your app on a simulated phone in a browser tab with one command and no Android Studio. What it replaces and how an AI agent drives it.
---

The slowest part of building a mobile app is often not the code. It is the wait to see it. You install Android Studio or Xcode, create an emulator, wait for it to boot, and only then find out whether your change looks right. If an AI agent writes the code, that wait is where the loop stalls.

This post shows the other way: one command that puts your app on a phone-shaped screen in a browser tab. We ran every step below on a clean Linux machine and show what we saw.

## Run a React Native app in the browser: the command

Inside a project made with `shipvo init`, type:

```bash
npx shipvo run android
```

Use `ios` for an iPhone-style frame. Shipvo builds a web copy of your app with Metro, serves it, and opens your browser on a page with a phone in the middle.

To check it, we made a fresh shop app and ran it:

```bash
npx -y @shipvo/cli init tidepool --template shop --name "Tidepool Shop"
cd tidepool && npm install
npx shipvo run android --no-open --port 4611
```

`npm install` took 30 seconds on that machine. The run printed this near the end:

```text
Web Bundled 5226ms index.ts (204 modules)
...
Simulated Android phone at http://127.0.0.1:4611/  (Ctrl+C to stop)
```

The page answered with HTTP 200. That is one timing from one run on a GitHub Actions Linux runner with Node 22, with an empty cache. It is not a benchmark.

## What you get on screen

| | Android | iOS |
| --- | --- | --- |
| Phone size | 412x915 | 393x852 |
| Look | Punch-hole camera, gesture bar | Dynamic Island, home indicator |

A label under the phone says **Simulated**. That is deliberate: this is your app running as a web build inside a phone frame, and it should never be mistaken for a real device. Add `?dark=1` to the address for a dark frame. Your app keeps its own colours.

The frame also has a button that shows the system sheet, the "Allow access?" question that comes from the phone and not from your app. It lets you see how a screen looks while it is covered, which is hard to check any other way without a device.

## Why this matters when an agent writes the code

A coding agent changes a screen, and then someone has to look at it. With an emulator, "someone" is you, after a boot. With `shipvo run`, the phone is already up and the agent can look at it too.

While the command runs, it writes `.shipvo/run.json` in your project with the port, platform, app name, a session token and the process ID, and adds `.shipvo/` to `.gitignore`. The token only works from your own computer.

When an assistant connected to the Shipvo MCP server calls `open_app` for the same app, it finds that file and drives your live phone. The result says `attached to the live shipvo run phone`. If no live phone is found, it says `headless session` and uses its own hidden phone instead.

The consequence is that you watch the agent tap through your app. You see the same screen it sees. When it says "the Pay button is missing", you can look at the tab and agree or disagree.

An attached session supports `screen`, `tap`, `type`, `scroll` and `back`. Other tools return `not_supported_attached`. Attaching needs Node 22 or newer. The assistant sees a list of buttons and text with `[ref=eN]` numbers it can tap. A ref from an earlier page returns `stale_ref`, so it never taps the wrong thing by accident. The full tool list is in the [agents guide](/docs/agents/).

To force the issue, ask for an error instead of a fallback by passing `attach: "always"`. If no `shipvo run` is live, you get `no_live_run`.

## Show it on your own phone, on the same Wi-Fi

Be aware that anyone on the network who has the address can open the page, and it is plain HTTP, so the phone's camera and sensors are not available this way.

```bash
npx shipvo run android --lan
```

This also serves the phone on your local network. Shipvo prints a URL with a random token (`?t=...`) and a QR code. On a phone browser the app fills the screen with no frame. Every request needs the token, otherwise the answer is 403.

## Proven against native

The simulator is held to the native app. We run the same flows on the simulator, the Android emulator and the iOS Simulator and compare every screen: all 13 screens of the two purchase flows are at 100% actionable parity on Android and iOS, with the same actionable elements, roles and labels. See the [parity results](/docs/parity-results/).

Want the native build too? `--native` runs your app on an emulator or simulator through `npx expo run:android` or `run:ios`.

## Fixing the common failures

- **`Port 4600 is in use`**: pick another with `--port 4700`.
- **It cannot build for web and names a file**: that file uses something that only works on a real phone. Fix or guard that file.
- **A message about `@shipvo/sim`**: your app predates this feature. Run `npm install --save-dev @shipvo/sim`.
- **The assistant says `headless session`**: `shipvo run` is not running in that project, or the app name differs.

## Where to go next

- Follow the beginner tutorial, [See your app on a phone in your browser](/learn/run-your-app-on-a-phone/), with screenshots at each step.
- Read the [run reference](/docs/run/) for every option.
- Let an assistant test the shop: [your assistant can test your app](/blog/your-assistant-can-test-your-app/), or the [testing guide](/docs/testing/).
- Record a demo of the phone: [record a demo video](/docs/record/).
- New here? Start with [build your first app](/docs/getting-started/).
