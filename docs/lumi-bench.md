# Lumi benchmark

This page is for developers who tune or check Lumi, the walker behind `shipvo explore`. You will get a repeatable benchmark and the measured results. `scripts/lumi/bench.mjs` runs Lumi Autotest on a fixed set of apps with a fixed step budget. It reports three numbers per app and budget:

- **Screens reached**: distinct screens the walker saw.
- **Flows finished**: how many of the five flows (sign up, log in, search, add to cart, checkout) ended with a pass on valid input.
- **Planted bugs found**: how many of the bugs switched on in the app showed up as a finding or a failed invalid-input flow.

## Run it

1. Build the CLI from the repository root:

```bash
pnpm --filter @shipvo/schema build && pnpm --filter @shipvo/cli build
```

2. Run the benchmark:

```bash
node scripts/lumi/bench.mjs                      # spec apps, budgets 50 and 200, seed 1
node scripts/lumi/bench.mjs --budgets 100 --seed 3 --out bench.json
node scripts/lumi/bench.mjs --start-sim --platform android   # also run Tide and Tackle on the Android simulator
node scripts/lumi/bench.mjs --sim http://localhost:4546 --platform ios
```

3. Read the table it prints, then the same data as JSON (`--json` prints only JSON). The same seed gives the same output.

Options: `--budgets <list>` (whole numbers, 1 or more), `--seed <n>`, `--bugs on|off`, `--ranker on|off`, `--platform android|ios`, `--sim <url>`, `--start-sim`, `--json`, `--out <file>`.

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

- **`--budgets must be whole numbers of 1 or more and --seed a whole number of 0 or more`**: write budgets as a comma list such as `--budgets 50,200`.
- **`--bugs must be on or off`**, **`--ranker must be on or off`**, **`--platform must be android or ios`**: use one of the listed values.
- **`tide-and-tackle skipped: pass --sim <url> or --start-sim to run it on a simulator.`**: the sample app only runs on a simulator. Add `--start-sim`, or `--sim <url>` for one that is already running.
- **`--ranker on: no trained model in this build. Run node scripts/lumi/train.mjs and build.`**: run `node scripts/lumi/train.mjs`, build again, then repeat with `--ranker on`. The [ranker page](lumi-ranker.md) explains the model.

## Next steps

- [Lumi](lumi.md): test your own app while you watch.
- [Explore feature log](explore-features.md): what the walker records for each action.
- [Lumi action ranker](lumi-ranker.md): the model comparison that uses this benchmark.
