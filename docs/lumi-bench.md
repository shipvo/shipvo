# Lumi benchmark

This page is for developers who want to measure how much of an app [Lumi](lumi.md) covers for a given step budget. You get a repeatable table of screens, flows and bugs found, and you can compare it before and after a change.

`scripts/lumi/bench.mjs` measures Lumi Autotest on a fixed set of apps with a fixed step budget. It reports three numbers per app and budget:

- **Screens reached**: distinct screens the walker saw.
- **Flows finished**: how many of the five flows (sign up, log in, search, add to cart, checkout) ended with a pass on valid input.
- **Planted bugs found**: how many of the bugs switched on in the app showed up as a finding or a failed invalid-input flow.

## Run it

1. Build the two packages the script uses:

   ```bash
   pnpm --filter @shipvo/schema build && pnpm --filter @shipvo/cli build
   ```

2. Run the bench. Pick one of these:

```bash
node scripts/lumi/bench.mjs                      # spec apps, budgets 50 and 200, seed 1
node scripts/lumi/bench.mjs --budgets 100 --seed 3 --out bench.json
node scripts/lumi/bench.mjs --start-sim --platform android   # also run Tide and Tackle on the Android simulator
node scripts/lumi/bench.mjs --sim http://localhost:4546 --platform ios
```

The script prints a table and then the same data as JSON (`--json` prints only JSON). The same seed gives the same output.

Expected output for `node scripts/lumi/bench.mjs --budgets 50,200 --seed 1` (checked on 2026-11-10):

```text
tide-and-tackle skipped: pass --sim <url> or --start-sim to run it on a simulator.
| app     | set      | budget | steps | screens | flows | bugs |
| ------- | -------- | ------ | ----- | ------- | ----- | ---- |
| shop    | tuning   | 50     | 43    | 5       | 2/5   | 3/3  |
| shop    | tuning   | 200    | 44    | 5       | 2/5   | 3/3  |
| account | held out | 50     | 50    | 0       | 2/5   | 1/3  |
| account | held out | 200    | 71    | 8       | 2/5   | 3/3  |
```

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

Measured on 2026-11-07 with `node scripts/lumi/bench.mjs --budgets 50,200 --seed 1` (bugs on, ranker off).

| App | Budget | Steps used | Screens | Flows finished | Planted bugs found |
| --- | --- | --- | --- | --- | --- |
| `shop` | 50 | 43 | 5 | 2 of 5 | 3 of 3 |
| `shop` | 200 | 44 | 5 | 2 of 5 | 3 of 3 |
| `account` | 50 | 50 | 0 | 2 of 5 | 1 of 3 |
| `account` | 200 | 71 | 8 | 2 of 5 | 3 of 3 |

## Troubleshooting

- **`tide-and-tackle skipped: pass --sim <url> or --start-sim`**: the sample app runs on a simulator. Add `--start-sim --platform android` (or `ios`), or point `--sim` at a running simulator.
- **`Cannot find module` for the CLI or schema**: run the two build commands in step 1 first.
- **Numbers differ between runs**: use the same `--seed` and the same budgets. The same seed gives the same output.

## Next steps

- [Lumi on Shipvo Phone](lumi.md): what Lumi does and how to run `shipvo lumi` on your app.
- [Lumi ranker](lumi-ranker.md): the ranker and its measured effect on these apps.
- [Test your app with Lumi](tutorials/test-your-app-with-lumi.md): a step-by-step tutorial.
