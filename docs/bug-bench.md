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

Measured on 13 Nov 2026 in a development container (Linux, 4 CPUs, Node 22.23.4, Chrome Headless Shell), with `node bench/run.mjs`. A bug that exists on one platform only is counted on that platform only, so the 23 bugs give 45 checks.

| Build | Android | iOS | Total |
| --- | --- | --- | --- |
| With phone platform mode | 22 of 22 | 23 of 23 | 45 of 45 |
| Without phone platform mode | 20 of 22 | 20 of 23 | 40 of 45 |

Every app logic and device hardware bug was caught in both builds. The five checks that differ are the Android and iOS only code class: [phone platform mode](device-api.md#android-and-ios-code-in-simulator-builds) keeps that code in the simulator build and runs it as the phone the session simulates.

The benchmark is also the app's test. `pnpm -r test` builds the app, runs all 45 checks and fails if a seeded bug is missed or a check stops passing on the fixed screen.

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
