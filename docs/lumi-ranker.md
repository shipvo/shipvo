# Lumi action ranker

Lumi's walker picks actions with its own algorithm. The ranker is an optional model that scores each action. The walker multiplies its order score by the model's prediction. With no model, the walker does exactly what it did before. This is covered by a test (`packages/cli/test/ranker.test.ts`).

## Result: the algorithm stays on its own

No trained model ships. On the held-out app the model did not find more screens, flows or planted bugs in the same steps. At 60 steps it found fewer. The weights file in the package is empty, and `walk` runs without a model.

Benchmark: `scripts/lumi/bench.mjs`, seeds 1, 2 and 3, budgets 40, 50, 60, 80, 100 and 150 steps, planted bugs on, in-process spec apps. `account` is the held-out app. Numbers are for `account` only.

| Steps | Model | Seed | Screens | Flows finished | Bugs found (of 3) |
| --- | --- | --- | --- | --- | --- |
| 40 | off | 1, 2, 3 | 0 | 2 | 1 |
| 40 | on | 1, 2, 3 | 0 | 2 | 1 |
| 50 | off | 1, 2, 3 | 0 | 2 | 1 |
| 50 | on | 1, 2, 3 | 0 | 2 | 1 |
| 60 | off | 1, 2, 3 | 6 | 2 | 3 |
| 60 | on | 1 | 5 | 2 | 2 |
| 60 | on | 2 | 6 | 2 | 2 |
| 60 | on | 3 | 5 | 2 | 2 |
| 80, 100, 150 | off and on | 1, 2, 3 | 8 | 2 | 3 |

Flows use the first steps of the budget, so the walker only starts to run at 60 steps on this app. The raw tables came from the commands below on the CI runner for this change; the CI run of the pull request repeats the build and tests.

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
node scripts/lumi/bench.mjs --budgets 40,50,60,80,100,150 --seed 1 --ranker off
node scripts/lumi/bench.mjs --budgets 40,50,60,80,100,150 --seed 1 --ranker on
```

`--ranker on` needs a trained model in the build. Commit a trained weights file only when the held-out numbers with the model on are better than with it off.
