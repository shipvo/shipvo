# Launch kit: Shipvo Phone for any Expo app, with a bug-catch benchmark and A2UI (Android and iOS)

Drafts for the owner to post. Every statement is from `docs/session.md`, `docs/bug-bench.md`, `docs/a2ui.md` and `docs/mcp-tools.md`. Every number is from `docs/bug-bench.md`, which links the run or the raw data it was measured in.

Released on 13 Nov 2026: `@shipvo/cli` 0.1.9, `@shipvo/sim` 0.1.9, `@shipvo/mcp` 0.0.14, `@shipvo/mcp-tools` 0.0.2, `@shipvo/device` 0.1.7. Updated on 15 Nov 2026 with the agent jobs benchmark and the release that carries it: `@shipvo/mcp` 0.0.15, `@shipvo/mcp-tools` 0.0.3, `@shipvo/sim` 0.1.10.

Links: [session](https://shipvo.dev/docs/session/), [bug-catch benchmark](https://shipvo.dev/docs/bug-bench/), [A2UI](https://shipvo.dev/docs/a2ui/), [MCP tool registry](https://shipvo.dev/docs/mcp-tools/), [repository](https://github.com/shipvo/shipvo).

## X post (under 280 characters)

Your coding agent can now test any Expo app on a phone, Android and iOS, with one command:

npx -y @shipvo/cli session start ios

No emulator, no Xcode, no account. 15 phone models. Screenshots and video in the real frame. Open source.

https://shipvo.dev/docs/session/

## X thread

1. Your coding agent can test any Expo app on a phone. Android and iOS. One command, on your own machine: `npx -y @shipvo/cli session start android`. No emulator, no Xcode, no account. Open source, Apache-2.0.

2. The agent reads the screen as a tree and acts with shell commands: `session screen`, `tap`, `type`, `scroll`, `back`. Every result is JSON with the next command to run.

3. Pick the phone: 15 models from Pixel 7 to iPhone 17 Pro Max, each with its screen size, pixel ratio, user agent and platform. `--device "iPhone 16 Pro"`.

4. Screenshots and video show the whole phone in its Android or iPhone frame with the status bar. `session record start` and `record stop` save an MP4 a person can review later.

5. We seeded 23 app bugs (logic, device hardware, Android-only and iOS-only code) and ran them on Shipvo Phone: 45 of 45 checks caught, on Android and iOS, in CI. Method and the command to run it: https://shipvo.dev/docs/bug-bench/

6. Then we gave the job to a real agent. Claude (claude-sonnet-5-5) tested 8 screens through the MCP tools, each with the bug and fixed, without being told which. It found 8 of 8 bugs and raised 0 false alarms: 16 of 16 runs passed. https://shipvo.dev/docs/bug-bench/

7. Tokens are what an agent's limit is spent on. With `SHIPVO_MCP_TOOLS=core` the server lists 14 tools, and the same 16 runs took 993,652 tokens against 3,157,776: 3.2 times fewer.

8. It is quick. Median on a 4-CPU Linux container: a phone opens in about 1.2 s, a screen read takes 167 ms, a tap 396 ms. A screen as a tree is 205 bytes. Numbers and method are on the same page.

9. It reads A2UI 1.0 too. Hand it an agent's A2UI messages and it draws them as a phone screen, with no app: `session start --a2ui booking.jsonl`. Over MCP: `a2ui_open`, `a2ui_send`, `a2ui_actions`. https://shipvo.dev/docs/a2ui/

10. Everything is on npm today: `@shipvo/cli`, `@shipvo/sim`, `@shipvo/mcp`, and the tool registry `@shipvo/mcp-tools`. Code: https://github.com/shipvo/shipvo

## LinkedIn post

Your coding agent can now test any Expo app on a phone, from the terminal, on Android and iOS.

Run `npx -y @shipvo/cli session start android` (or `ios`) in the app folder. Shipvo builds the app, opens it on a headless Shipvo Phone and prints the first screen as a tree your agent can read. No emulator, no Xcode, no account.

What shipped today:

- 15 phone models, from Pixel 7 to iPhone 17 Pro Max, each with its screen size, pixel ratio, user agent and platform.
- Screenshots and video of the whole phone in its Android or iPhone frame with the status bar, saved for a person to review.
- A bug-catch benchmark: 23 seeded app bugs, 45 checks on Android and iOS, 45 of 45 caught in CI. The method and the command are public.
- An agent jobs benchmark: a real agent (claude-sonnet-5-5) tested 8 screens through the MCP tools, each with the bug and fixed. It found 8 of 8 bugs with 0 false alarms, and `SHIPVO_MCP_TOOLS=core` cut its tokens 3.2 times (993,652 against 3,157,776).
- A speed benchmark: a phone opens in about 1.2 seconds and a screen read takes 167 ms (median, 4-CPU Linux container).
- A2UI 1.0: an agent's A2UI messages become a phone screen with no app, from the CLI and over MCP.
- An approval guard: with `SHIPVO_GUARD=on`, a tap on Pay, Buy now, Place order or Delete account waits for a person.
- `@shipvo/mcp-tools` on npm: every Shipvo MCP tool as data.

It runs on your own machine and it is open source under Apache-2.0.

Docs: https://shipvo.dev/docs/session/
Benchmark: https://shipvo.dev/docs/bug-bench/

## Show HN-style description

Show HN: Shipvo Phone, a headless Android and iOS phone for any Expo app that a coding agent drives from the shell

`npx -y @shipvo/cli session start android|ios --device "iPhone 16 Pro" --max-duration-minutes 20 --json` builds an Expo app for web, opens it in a headless browser as one of 15 phone models, and returns the screen as an accessibility tree with refs. `session tap e6`, `type`, `scroll` and `back` act on it. `screenshot` and `record start|stop` save the phone in its frame with the status bar as a PNG and an MP4. A timer ends the session. The same simulator answers MCP tools through `@shipvo/mcp`, and it draws A2UI 1.0 messages as a screen with no app.

We measured it. A benchmark app holds 23 seeded bugs (app logic, device hardware such as camera, location and network, and Android-only and iOS-only code). Shipvo Phone caught 45 of 45 checks on Android and iOS in CI; the page links the run. We also ran a real agent on it: Claude Code with claude-sonnet-5-5 tested 8 of those screens through the MCP tools, each with the bug and fixed, and was scored on its verdict. 16 of 16 runs passed: 8 of 8 bugs found, 0 false alarms. Listing only the 14 core tools (`SHIPVO_MCP_TOOLS=core`) took 993,652 tokens against 3,157,776 for the full list. On a 4-CPU Linux container a phone opens in about 1.2 s (median) and a screen read takes 167 ms. Method, results and the command: https://shipvo.dev/docs/bug-bench/

Apache-2.0. Runs on your machine. https://github.com/shipvo/shipvo

## Prompt to share

```text
Run `npx -y @shipvo/cli session start android --max-duration-minutes 20 --json` in my app folder.
Follow `next` in each result. Run `shipvo session record start`, tap through the main screens, save a
screenshot of each, run `shipvo session record stop`, tell me what broke, then run `shipvo session stop`. Repeat with `ios`.
```
