# Bug-catch benchmark

This page is for developers and teams who want to know how many app bugs show up on Shipvo Phone before a phone sees the build. You get the method, the measured result on Android and iOS, and the command to run it yourself.

## What it measures

`apps/bug-bench` is an Expo app with 23 seeded bugs. Each bug has two versions of its screen, one with the bug and one with the fix, and one check. The check is a short script of taps, typing and screen reads, the same actions an agent uses.

A bug is **caught** when the check passes on the fixed screen and fails on the buggy screen, on Shipvo Phone. The benchmark opens every bug both ways on the Android phone and the iOS phone and counts.

| Class | Seeded bugs | Examples |
| --- | --- | --- |
| App logic | 12 | The total ignores the quantity. A second tap places a second order. A slow older search replaces the newer result. Opening a screen throws while rendering. |
| Device hardware | 8 | A denied camera or location leaves a spinner. A failed fingerprint still pays. A declined or timed-out payment still places the order. A request made offline never finishes. |
| Android and iOS only code | 3 | The bug is in a `.native.js` file, in the native branch of `Platform.select`, or in a `Platform.OS === "ios"` branch. |

The device hardware bugs are set up through the simulated device: the check sets the permission, the fingerprint result, the payment result or the network, then uses the app.

## Result

Measured on 13 Nov 2026. A bug that exists on one platform only is counted on that platform only, so the 23 bugs give 45 checks.

The first row is from CI on a GitHub-hosted Linux runner: [run 43383998094](https://github.com/shipvo/shipvo/actions/runs/43383998094), job `test`, step `pnpm -r test`, which printed `Total: 45 of 45 caught`. The second row was measured in a development container (Linux, 4 CPUs, Node 22.23.4, Chrome Headless Shell) with `BUG_BENCH_PHONE_PLATFORM=off node bench/run.mjs`; the same container also measured 45 of 45 for the first row.

| Build | Android | iOS | Total |
| --- | --- | --- | --- |
| With phone platform mode | 22 of 22 | 23 of 23 | 45 of 45 |
| Without phone platform mode | 20 of 22 | 20 of 23 | 40 of 45 |

Every app logic and device hardware bug was caught in both builds. The five checks that differ are the Android and iOS only code class: [phone platform mode](device-api.md#android-and-ios-code-in-simulator-builds) keeps that code in the simulator build and runs it as the phone the session simulates.

The benchmark is also the app's test. `pnpm -r test` builds the app, runs all 45 checks and fails if a seeded bug is missed or a check stops passing on the fixed screen.

## Speed and size

`apps/bug-bench/bench/speed.mjs` times what an agent does all day on Shipvo Phone, and measures what the agent has to read. Measured on 13 Nov 2026 in a development container (Linux, 4 CPUs, Node 22.23.4, Chrome Headless Shell) with `node bench/speed.mjs`. Times are the median of 10 runs (5 for opening a phone). A second run gave the same numbers within 10 ms.

| | Pixel 8 | iPhone 16 |
| --- | --- | --- |
| Open a phone, to its first screen | 1,243 ms | 1,219 ms |
| Read the screen | 167 ms | 165 ms |
| Tap | 396 ms | 396 ms |
| Type | 388 ms | 380 ms |
| Screenshot | 250 ms | 250 ms |
| Screenshot of the phone in its frame | 370 ms | 369 ms |
| A screen as a tree (median of 5 screens) | 205 bytes | 205 bytes |
| The same screen as a PNG | 37,833 bytes | 39,830 bytes |

A tap and a type include the wait for the screen to settle and the new screen in the reply. The tree is what an agent reads to act; on these screens the picture of the same screen is 185 times (Pixel 8) and 194 times (iPhone 16) its size.

Memory of the simulator and its browser, with phones held open: 589 MB with none, 936 MB with 1, 1,459 MB with 3, 2,016 MB with 5. Each extra phone adds 270 MB. A phone model adds nothing to that: the same run with no model, a Pixel 8 and an iPhone 16 gave 268.7, 268.3 and 268.9 MB per extra phone.

### Two apps from GitHub

The same measurements on the first screen of two open-source Expo apps, built from their public source and opened with `shipvo session`. Same container, same day, median of 10 screen reads, 5 screenshots and 3 opens.

| | Obytes starter, Pixel 8 | Obytes starter, iPhone 16 | Bluesky, Pixel 8 | Bluesky, iPhone 16 |
| --- | --- | --- | --- | --- |
| Open a phone, to its first screen | 1,268 ms | 1,271 ms | 4,608 ms | 4,575 ms |
| Read the screen | 169 ms | 170 ms | 249 ms | 257 ms |
| Screenshot | 259 ms | 269 ms | 931 ms | 843 ms |
| Screenshot of the phone in its frame | 392 ms | 400 ms | 1,355 ms | 1,369 ms |
| The screen as a tree | 385 bytes | 385 bytes | 436 bytes | 436 bytes |
| The same screen as a PNG | 131,968 bytes | 151,204 bytes | 832,633 bytes | 827,438 bytes |

Both apps were then used end to end: the Obytes starter (Expo 54, expo-router) through onboarding, form validation, login, its feed, a post screen, a phone restart on that screen, Settings, the theme sheet, dark theme and logout; Bluesky (Expo 58, React Navigation) through its welcome screen, the signed-out Discover feed, the drawer menu and the sign-in form.

## Agent jobs

`apps/bug-bench/bench/agent-jobs.mjs` gives the work to a real coding agent. The agent gets one screen and one sentence on what the screen should do. It uses the screen through the Shipvo Phone MCP tools and ends its report with `VERDICT: BUG` or `VERDICT: OK`.

Each of the 8 jobs runs twice: on the screen with the seeded bug and on the fixed screen. The agent is not told which one is open. A run on the buggy screen passes when the verdict is BUG and the report names the bug. A run on the fixed screen passes when the verdict is OK, so an agent that always says BUG fails half its runs.

Measured on 14 Nov 2026 in a development container (Linux, 4 CPUs, Node 22.23.4) with Claude Code 2.1.325 and `claude-sonnet-5-5`, one run per job and variant, on a simulated Pixel 8. The agent had the phone tools only. Tokens are input, output, cache write and cache read together. Raw runs: [bug-bench-agent-runs.json](bug-bench-agent-runs.json).

| MCP server setup | Runs passed | Bugs found | False alarms | Tokens | Tool calls | Seconds |
| --- | --- | --- | --- | --- | --- | --- |
| As it ships | 16 of 16 | 8 of 8 | 0 of 8 | 3,157,776 | 82 | 191 |
| Whole screens (`SHIPVO_MCP_FULL_SCREEN=1`) | 16 of 16 | 8 of 8 | 0 of 8 | 3,081,959 | 81 | 185.7 |
| Core tools (`SHIPVO_MCP_TOOLS=core`) | 16 of 16 | 8 of 8 | 0 of 8 | 993,652 | 78 | 187.9 |

What the numbers say:

- The agent found all 8 seeded bugs and raised no false alarm, in every setup.
- With `SHIPVO_MCP_TOOLS=core` the same jobs took 3.2 times fewer tokens: 993,652 against 3,157,776. The server then lists 14 tools, so the agent reads a much shorter tool list on every turn.
- Changed lines and whole screens came out within 2.5% of each other. These screens have under ten lines, so a whole screen is already short.

The jobs are `cart-total`, `stale-state`, `delete-wrong-row`, `double-submit`, `empty-form`, `pagination-repeat`, `nav-state-lost` and `button-stays-disabled`. The heading of each screen shows its case id on both variants.

Run it yourself (needs the `claude` command signed in):

```bash
pnpm --filter @shipvo/mcp... build
cd apps/bug-bench
BENCH_MODEL=claude-sonnet-5-5 node bench/agent-jobs.mjs --out runs.json
```

`--jobs cart-total,empty-form` picks jobs, `--sides core-tools` picks setups and `--runs 3` repeats each run; tokens, tool calls and seconds are then the sum of each job's median.

### Run another MCP server on the same jobs

`--sides-file sides.json` adds other MCP servers as setups, so two tools can be compared on the same jobs with the same agent and the same scoring. Each entry has a `name`, the `serverName` and MCP `config` to give the agent, and an `openCmd` that opens a case on that tool's device (`{id}` and `{variant}` are replaced):

```json
[{ "name": "other-tool", "serverName": "phone",
   "config": { "mcpServers": { "phone": { "command": "npx", "args": ["-y", "other-tool", "mcp"] } } },
   "openCmd": "./open-case.sh {id} {variant}" }]
```

## Run it

1. Install and build the packages:

   ```bash
   corepack enable && pnpm install --frozen-lockfile
   pnpm --filter @shipvo/schema build && pnpm -r build
   ```

2. Run the benchmark:

   ```bash
   cd apps/bug-bench
   node bench/run.mjs --out results.json
   ```

3. Read the table it prints. `results.json` holds one row per check with `fixedPass`, `buggyPass` and `result`.
4. For the speed and size numbers, run `node bench/speed.mjs --out speed.json`. `--models "Pixel 8,iPhone 16 Pro"` picks the phones and `--skip-build` reuses the build.

Options: `--skip-build` (use the existing `sim-dist`), `--parallel <n>` (checks at a time, default 4), `--json` (print the JSON instead of the table), `--out <file>`, `--port <n>`. Set `BUG_BENCH_PHONE_PLATFORM=off` to build without phone platform mode.

Each row's `result` is one of:

| Result | Meaning |
| --- | --- |
| `caught` | The check passes on the fixed screen and fails on the buggy one. |
| `missed` | The check passes on both. The bug did not show up. |
| `invalid` | The check fails on the fixed screen, or a run ended before its check answered. The command exits 1. |

## Add a bug

1. Add a screen to `apps/bug-bench/src/cases.js` that takes `buggy` and register it under a new id.
2. Add the same id to `apps/bug-bench/bench/cases.mjs` with its class, a title and a `check`.
3. Run the benchmark. The new row must be `caught` or `missed`, never `invalid`.

## Troubleshooting

| You see | Why | Fix |
| --- | --- | --- |
| `the web build failed` | The Expo export stopped. The last lines of its output follow. | Fix the named file, then run again. |
| `the simulator did not start` | No Chromium, or the port is taken. | Run `shipvo doctor`, or pass `--port <n>`. |
| A row is `invalid` | The check fails on the fixed screen. | Run with `BUG_BENCH_DEBUG=1` to see why, and fix the check or the screen. |

## Next steps

- [Simulator vs device parity](parity-results.md)
- [Device API](device-api.md)
- [Test any Expo app from the terminal](session.md)
