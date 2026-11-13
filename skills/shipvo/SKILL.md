---
name: shipvo
description: Set up and use Shipvo in an Expo or React Native app. Use when the user wants to run the app on Shipvo Phone, test it through MCP or with @shipvo/test, publish a signed over-the-air update or roll one back, prepare a first store release, or record a demo video.
---

# Shipvo

Shipvo gives a React Native app signed over-the-air updates and a headless phone that agents drive over MCP. Prefer `shipvo` commands over hand-written scripts. When unsure what is wrong, run `npx -y @shipvo/cli doctor`, then `npx -y @shipvo/cli status --json`.

Run commands from the app's root folder. Use `npx -y @shipvo/cli <command>` if `shipvo` is not on the path. Features marked **planned** do not exist yet: do not call them.

## Set up Shipvo in an existing Expo or React Native app

```bash
shipvo init --dry-run    # print the plan, change nothing
shipvo init --yes        # apply it
shipvo doctor            # check the setup
```

`init` installs `@shipvo/runtime`, adds the config plugin and a git-ignored signing key in `.shipvo/seed.txt`, and writes `shipvo.json`. It never overwrites a file and refuses apps that use `expo-updates` or CodePush. Rebuild the native app once afterwards. Never print or commit `.shipvo/seed.txt`. Details: `references/setup.md`.

## Run the app on Shipvo Phone

```bash
shipvo run android       # phone frame in your browser (or: shipvo run ios)
shipvo sim               # headless simulator on http://localhost:4545
shipvo sim --watch       # rebuild on file changes
```

`shipvo run` writes `.shipvo/run.json`. While it is up, `open_app` over MCP drives that same phone. `shipvo run android --native` uses a real emulator instead.

## Test any Expo app from the shell

Works in any Expo app folder. No `shipvo.json`, no emulator, no account.

```bash
shipvo session start android --max-duration-minutes 20 --json   # a Pixel 8; `ios` is an iPhone 16
shipvo session start --device "iPhone 16 Pro" --json            # a named model; `shipvo session devices` lists them
shipvo session screen            # the screen as a tree; every element you can act on has [ref=eN]
shipvo session tap e6            # also: type <ref> <text>, scroll <up|down|left|right> [<ref>], back
shipvo session errors            # what the app threw, and scripts that did not load
shipvo session screenshot --out shots/home.png        # the phone in its frame, for a person to look at
shipvo session record start      # then act, then: shipvo session record stop --out videos/run.mp4
shipvo session stop              # then `shipvo session clean` removes stopped sessions and their files
```

How to work:

1. Start with `--json` and read `data.screen`. Every result has `next`: its first command is the usual next step.
2. Act by ref. Refs change when the screen changes, so use the refs from the newest result, never an older one.
3. After each action read the screen it returns. Do not assume the action worked.
4. A blank or wrong screen: run `shipvo session errors` before anything else.
5. Save a screenshot of each screen you check, and stop the session when you are done. It also stops on its own at `data.expires_at`.

When a command fails, `code` says what to do: `web_deps_missing` (run the command in `next`), `build_failed` (the summary names the cause), `bad_model` (use a name from `shipvo session devices`), `stale_ref` (read the screen again), `covered` (something is on top of that element: close it or tap the one on top), `no_session` or `session_stopped` (start a session). Full workflow and what the phone does for real apps: `references/session.md`.

## Test it through @shipvo/mcp

Add the server to your MCP config (`shipvo mcp` prints it):

```json
{ "mcpServers": { "shipvo": { "command": "npx", "args": ["-y", "@shipvo/mcp"] } } }
```

Then: `open_app("<app id>")` → `screen(session)` (tree with `[ref=eN]`) → `tap` / `type` / `scroll` / `back` → `screenshot`. `phone_models` lists the phones; pass one as `open_app(model: "iPhone 16 Pro")`. `screenshot(frame: true)` returns the phone in its frame. Use `set_device` for location, permissions, biometrics, payment and network. The tree shows what a person with a screen reader would get. To walk the whole app and get a report, run `shipvo explore`. Tool list: `references/mcp.md`.

## Write and run @shipvo/test tests

```bash
npm i -D @shipvo/test vitest @shipvo/sim playwright
shipvo sim               # in one terminal
npx vitest run           # in another
```

```ts
import { test, expect } from "@shipvo/test/vitest";
test("adds to cart", async ({ phone }) => {
  await phone.tap("Add 1 to cart");
  expect(phone).toSee("Cart");
});
```

Plain-line tests live in `tests/*.steps` and run with `shipvo test`. Use `shipvo test --repair` to see a diff for broken steps. Use `--report report.json` to write results for `shipvo promote --report`.

## Publish a signed update and roll back

```bash
shipvo publish --dry-run     # build and sign, write nothing remote
shipvo publish               # publish to the first cohort
shipvo status --json         # how the newest releases do on phones
shipvo promote --to b1,b2    # widen to more cohorts
shipvo rollback --to 12      # republish release 12 as a new release
```

Always dry-run first. Crash-loop rollback on the phone is automatic. `shipvo auto-halt` shows or sets the crash threshold. Add `--json` to `publish`, `promote`, `rollback` and `auto-halt` to get one envelope on stdout: `{ ok, code, summary, data, next }`. Exit 0 ok, 1 failed, 2 usage error. Run the first command in `next`. `data`: `publish` gives `{ app, release, bands, min_shell_version, bytes, patches }` (`dry_run: true` and `out` for a dry run); `promote` gives `{ dry_run, promoted: [{ platform, release, from, bands }] }`; `rollback` gives `{ app, rolled_back_to_code_of, new_release, min_shell_version, platforms, bands, dry_run }`; `auto-halt` gives `{ enabled, threshold, min_reports, dry_run, changed }`. Full table: `docs/cli.md`. Never weaken or skip signing. Back up the key with `shipvo keys export`. Details: `references/publish.md`.

## First store release

```bash
shipvo store details --dry-run   # draft Play Data safety answers and a privacy policy
shipvo store setup               # pick store accounts, write store-plan.json
shipvo store screenshots         # store-size screenshots
shipvo store testers             # steps to get 12 closed-test testers
shipvo store status              # each step and what is next
```

`store testers --play-key key.json` adds the Shipvo Testers group (`shipvo-testers@googlegroups.com`) to your closed track. It never removes a group. Join the community at https://shipvo.dev/testers.

## Record a demo video

Over MCP, with a session open: `record_start` → do the steps, calling `record_marker("caption")` for chapters → `record_stop`. It writes an MP4 of the phone frame to `.shipvo/recordings/` and returns the file, duration, size and chapters. It needs ffmpeg.

## Planned

`shipvo smoke [android|ios] [--timeout 30] [--json]` answers "does the app load?" Exit 0 loads, 1 failed, 2 setup error. JSON: `{ ok, code, summary, data: { platform, time_to_first_screen_ms, elements, errors, error_count }, next }`; `data.errors` has the first 5 errors. `android` (default) or `ios` is passed to the simulator as the session's device platform; another value exits 2.

`shipvo agents setup` and `--json` on every command are planned (see issue 533). Today `smoke`, `doctor`, `test`, `explore`, `status`, `publish`, `promote`, `rollback` and `auto-halt` take `--json`.
