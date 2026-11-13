# Testing an app with `shipvo session`

Use this when you have a shell and an Expo app folder. One session is one phone. Commands after `start` act on the newest running session; add `--id <id>` to name one. Add `--json` to every command and read the one JSON document it prints: `{ ok, code, summary, data, next }`.

## A full pass over an app

1. `shipvo session start android --max-duration-minutes 20 --json`. Use `ios`, or `--device "<model>"` for a named phone. If `code` is `web_deps_missing`, run the command in `next` and start again.
2. Read `data.screen`. It is the accessibility tree: one line per element, with its role, its name and `[ref=eN]`.
3. For each screen: read it, save `shipvo session screenshot --out shots/<name>.png`, then act (`tap`, `type`, `scroll`, `back`).
4. After a tap that should move to another screen, check that the new screen shows what you expect. If it does not, run `shipvo session errors`.
5. Try the unhappy paths: submit a form empty, type a wrong value, go back half way through a flow.
6. Repeat on the other platform: `shipvo session start ios`.
7. `shipvo session stop`, then report what worked and what broke, with the screenshot of each problem.

To keep a video for a person: `shipvo session record start` before the steps and `shipvo session record stop --out videos/<name>.mp4` after them.

## Reading the screen

- A `button`, `link`, `tab` or `textbox` line with a name is something a person can use. A `generic` line is text.
- Some apps give their buttons no role or name. They show as `generic [cursor=pointer]`: tap them by ref the same way. Say so in your report, because a screen reader user cannot find them.
- A textbox with no name: find it by the label text on the line before it.
- Two elements can have the same name (a button on the page and the same button in an open menu). Tap the one in the part of the screen that is on top.

## Results that are not failures of your test

- `covered`: another element is on top of the one you tapped, so nothing was sent, as on a phone. Close the menu or sheet, or tap the element on top.
- `stale_ref`: the screen changed. Read it again and use the new ref.
- `disabled`: the control is disabled. That is a finding if it should be enabled.

## What the phone does for a real app

- An app that uses expo-router or React Navigation opens on its own first screen, and `/feed/1` style screens survive a phone restart.
- An app built with a base path gets its files under that path.
- The session opens once the app has loaded, also when the app keeps the network busy.
- The app may play sound without a tap first.
- The session's simulator listens on this machine only.

## When an app does not open

| What you see | Meaning | What to do |
| --- | --- | --- |
| `build_failed`, naming a Node version | The app needs another Node version. | Switch to it and start again. |
| `build_failed`, naming `"web": { "bundler": "metro" }` | An older app is not set up to build for web. | Add that setting to the app config, or report that the app has no web build. |
| `build_failed`, naming a file | That file does not compile for web. | Report the file and the message. |
| The screen is blank | The app's code did not run or stopped. | `shipvo session errors` names the cause. |
| A 3D scene or a game canvas is blank and `errors` names a graphics call | The app's own web build does not draw it. | Report it. The rest of the app can still be tested. |

## Phone state and hardware

Over MCP, `set_device` sets what the phone has: permissions, location, a barcode in front of the camera, whether the fingerprint matches, whether a payment is approved, network on or off. `shipvo session start` prints `data.mcp_env`: start `@shipvo/mcp` with it to drive the same phone. See `mcp.md`.
