# Lumi action ranker

This page is for developers who want to know how Lumi chooses what to tap next, and what the optional ranker model measured. You will see the benchmark numbers, how the model is trained and the commands to repeat it. If you only want Lumi to test your app, read [Lumi on Shipvo Phone](lumi.md) instead.

Lumi's walker picks actions with its own algorithm. The ranker is an optional model that scores each action. The walker multiplies its order score by the model's prediction. With no model, the walker does exactly what it did before. This is covered by a test (`packages/cli/test/ranker.test.ts`).

## Result: the algorithm stays on its own

No trained model ships. On the held-out app the model did not find more screens, flows or planted bugs in the same steps. At 60 steps it found fewer. The weights file in the package is empty, and `walk` runs without a model.

Benchmark: `scripts/lumi/bench.mjs`, seeds 1, 2 and 3, budgets 40, 50, 60, 80, 100 and 150 steps, planted bugs on, in-process spec apps. `account` is the held-out app. Numbers are for `account` only.

| Steps | Model | Screens | Flows finished | Bugs found (of 3) |
| --- | --- | --- | --- | --- |
| 40, 50 | off and on | 0 | 2 | 1 |
| 60 | off (seeds 1, 2, 3) | 6 | 2 | 3 |
| 60 | on, seed 1 | 5 | 2 | 2 |
| 60 | on, seed 2 | 6 | 2 | 2 |
| 60 | on, seed 3 | 5 | 2 | 2 |
| 80, 100, 150 | off and on | 8 | 2 | 3 |

Flows use the first steps of the budget, so the walker only starts to run at 60 steps on this app. Raw results, one JSON file per seed and setting: [`docs/lumi-ranker-bench/`](lumi-ranker-bench/) (`bench-off-<seed>.json`, `bench-on-<seed>.json`). They were produced by the commands below on the CI runner for this change (the `account` rows are the table above). The model used for `on` was trained by `train.mjs` on the same runner: `shop, library, tasks; 40 seeds; 5386 actions; 2560 positive` (the `trainedOn` line it writes). The trained file was not committed because it did not win.

## Method

- **Data.** Self-play. The walker, model off, explores `shop` (a tuning app), and two training-only apps (`scripts/lumi/train-apps.mjs`) with seeds 1 to 40 and budgets of 8, 20 and 60 steps. Each action taken is one row. The held-out `account` app is never used for training.
- **Features.** Role, tap or type, risky, invalid input, Enter, repeated name, depth, share of actions already tried, number of actions and fields on the screen. No text. See `docs/explore-features.md` and `packages/cli/src/ranker.ts`.
- **Label.** 1 when the action reached a new screen or produced a finding.
- **Model.** Logistic regression, batch gradient descent with L2, no random numbers. The same data gives the same file.
- **Use.** On a screen, the walker takes the safe action with the highest `prediction / (1 + position)`. Risky actions stay last.

## Train and compare

```bash
pnpm --filter @shipvo/cli build
node scripts/lumi/train.mjs            # writes packages/cli/src/ranker-weights.ts
pnpm --filter @shipvo/cli build
node scripts/lumi/bench.mjs --budgets 40,50,60,80,100,150 --seed 1 --ranker off --out bench-off-1.json   # repeat for seeds 2 and 3
node scripts/lumi/bench.mjs --budgets 40,50,60,80,100,150 --seed 1 --ranker on --out bench-on-1.json   # repeat for seeds 2 and 3
```

`--ranker on` needs a trained model in the build. Commit a trained weights file only when the held-out numbers with the model on are better than with it off.

## Troubleshooting

- **`--ranker on: no trained model in this build`**: the weights file in the package is empty. Run `node scripts/lumi/train.mjs`, then `pnpm --filter @shipvo/cli build`, then run the benchmark again.
- **`--ranker must be on or off`**: pass exactly `on` or `off`.
- **`Cannot find module` for the CLI**: run `pnpm --filter @shipvo/cli build` first.
- **Numbers differ from the table**: use the same `--seed` and budgets. The same seed gives the same output.

## Next steps

- [Lumi on Shipvo Phone](lumi.md): run `shipvo lumi` on your app.
- [Lumi benchmark](lumi-bench.md): the numbers for Lumi across sample apps, and how to repeat them.
- [Explore feature log](explore-features.md): the features the model reads.
