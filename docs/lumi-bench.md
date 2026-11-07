# Lumi benchmark

`scripts/lumi/bench.mjs` measures Lumi Autotest on a fixed set of apps with a fixed step budget. It reports three numbers per app and budget:

- **Screens reached**: distinct screens the walker saw.
- **Flows finished**: how many of the five flows (sign up, log in, search, add to cart, checkout) ended with a pass on valid input.
- **Planted bugs found**: how many of the bugs switched on in the app showed up as a finding or a failed invalid-input flow.

## Run it

```bash
pnpm --filter @shipvo/schema build && pnpm --filter @shipvo/cli build
node scripts/lumi/bench.mjs                      # spec apps, budgets 50 and 200, seed 1
node scripts/lumi/bench.mjs --budgets 100 --seed 3 --out bench.json
node scripts/lumi/bench.mjs --start-sim --platform android   # also run Tide and Tackle on the Android simulator
node scripts/lumi/bench.mjs --sim http://localhost:4546 --platform ios
```

The script prints a table and then the same data as JSON (`--json` prints only JSON). The same seed gives the same output.

## Apps

| App | Set | Runs on | Planted bugs |
| --- | --- | --- | --- |
| `shop` | tuning | in-process spec app | dead button, failing network call, validation that accepts bad input |
| `account` | held out | in-process spec app | broken route, blank screen, validation that accepts bad input |
| `tide-and-tackle` | tuning | Android and iOS simulator (`--sim` or `--start-sim`) | none |

Held-out apps are for checking a change that was tuned on the others. Do not tune the walker on them.

## How the budget works

A step is one tap, type, open-URL or back action. Opening a fresh phone is free. Flows run first, each with valid and then invalid input, and stop when the budget is used. The walker gets what is left. Walker replays do not count, the same as in `shipvo explore --max-steps`.

## Planted bugs

Each bug has a flag in `scripts/lumi/spec-app.mjs` and a check that says which finding shows it. `packages/cli/test/lumi-bench.test.ts` turns on one bug at a time and checks that the engine finds that bug, and only that bug, with a budget of 1000. It also checks that nothing is found when all flags are off.

## Results

Measured on 2026-11-07 with `node scripts/lumi/bench.mjs --budgets 50,200 --seed 1` (bugs on, ranker off). `tide-and-tackle` was not run in this measurement.

| App | Budget | Steps used | Screens | Flows finished | Planted bugs found |
| --- | --- | --- | --- | --- | --- |
| `shop` | 50 | 43 | 5 | 2 of 5 | 3 of 3 |
| `shop` | 200 | 44 | 5 | 2 of 5 | 3 of 3 |
| `account` | 50 | 50 | 0 | 2 of 5 | 1 of 3 |
| `account` | 200 | 71 | 8 | 2 of 5 | 3 of 3 |
