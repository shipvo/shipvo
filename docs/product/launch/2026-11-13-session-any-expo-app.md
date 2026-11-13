# Launch kit: `shipvo session`, any Expo app on Shipvo Phone from the terminal (Android and iOS)

Drafts for the owner to post. Every statement is from `docs/session.md` and `changes/session-any-expo-app.md`; no numbers are claimed.

Links: [docs](../../session.md), [CLI reference](../../cli.md#shipvo-session), [repository](https://github.com/shipvo/shipvo).

## X post (under 280 characters)

Your coding agent can now test any Expo app on a phone with one command:

npx -y @shipvo/cli session start ios

Android and iOS. No emulator, no Xcode, no account. It taps, types, and saves screenshots and video of the phone in its frame. Open source, Apache-2.0.

## LinkedIn post

Your coding agent can test any Expo app on a phone, from the terminal.

Run `npx -y @shipvo/cli session start android` (or `ios`) in the app folder. Shipvo builds the app, opens it on a headless Shipvo Phone and prints the first screen as a tree your agent can read.

- Works with any Expo app. No `shipvo init`, no emulator, no Xcode, no account.
- The agent drives it with shell commands: `session screen`, `tap`, `type`, `scroll`, `back`, `screenshot`.
- Screenshots show the whole phone: the app in its Android or iPhone frame with the status bar.
- `session record start` and `record stop` save an MP4 of the phone, so a person can review the run later.
- `--max-duration-minutes` stops the session on its own.
- Every command takes `--json` and returns the next command to run.
- Watch the phone live in your browser in its Android or iOS frame.

It runs on your own machine and it is open source under Apache-2.0.

Docs: https://shipvo.dev/docs/session/

## Show HN-style description

Show HN: Shipvo session, a headless phone for any Expo app that a coding agent drives from the shell

`npx -y @shipvo/cli session start android|ios --max-duration-minutes 20 --json` builds an Expo app for web, opens it in a phone-sized headless browser with an Android or iOS frame, and returns the screen as an accessibility tree with refs. `session tap e6`, `type`, `scroll` and `back` act on it, `screenshot` and `record start|stop` save the phone in its frame with the status bar as a PNG and an MP4, `session get|list|stop` manage it, and a timer ends it. Results are one JSON envelope with a `next` list. It needs no emulator, Xcode or account, and the same simulator answers MCP tools through `@shipvo/mcp`. Apache-2.0. Docs: https://shipvo.dev/docs/session/

## Prompt to share

```text
Run `npx -y @shipvo/cli session start android --max-duration-minutes 20 --json` in my app folder.
Follow `next` in each result. Run `shipvo session record start`, tap through the main screens, save a
screenshot of each, run `shipvo session record stop`, tell me what broke, then run `shipvo session stop`. Repeat with `ios`.
```

## 30-second demo script (Video Studio)

1. 0-6 s: Terminal in a fresh Expo app. Type `npx -y @shipvo/cli session start ios`.
2. 6-12 s: The first screen prints as a tree with refs. Open the watch link: the iPhone frame shows the app.
3. 12-20 s: `shipvo session tap e6`, then `shipvo session type e8 "Hans"`. The phone updates after each one.
4. 20-26 s: `shipvo session screenshot --out shots/home.png`: the picture shows the iPhone frame and status bar. Then the same on `android`, and the recorded MP4 playing.
5. 26-30 s: Caption: "Any Expo app. Android and iOS. One command."
