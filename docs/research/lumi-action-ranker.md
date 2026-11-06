# Research: a learned action ranker for Lumi

Question: can a small model, trained on recorded runs, pick the next action in `shipvo explore` better than the heuristic (unexplored first, risky labels last, seeded shuffle)?

## What was built

- `packages/cli/src/explore-ranker.ts`: a logistic regression over 29 anonymous features. Pure TypeScript, no dependency, no service.
- Features are roles, counts, positions and word-class flags (for example "label looks like Continue or Next"). Label text, screen text and typed values are never recorded. A test checks that two different labels in the same class give the same vector.
- The label of a sample is 1 when the action reached a new screen or a new finding, else 0.
- Recording is opt-in: `shipvo explore --record-features samples.jsonl` appends one JSON line per action. Nothing is recorded or sent without that flag.
- `shipvo explore --train samples.jsonl --ranker-out ranker.json` trains a model. `shipvo explore --ranker ranker.json` uses it to choose among the safe actions on a screen. Risky actions still go last.

## Measurement

Run by `packages/cli/test/explore-ranker.test.ts` (apps in `packages/cli/test/bench/apps.ts`). Re-run it with `pnpm --filter @shipvo/cli test -- explore-ranker`.

- Benchmark: 70 generated fake apps with 18 to 31 screens, behind the walker's `Driver` interface. A button's label hints at what it does about 4 times in 5 and each app shifts the odds. Bugs (network text, spinner, blank) sit on about 14% of screens.
- Training: 30 apps, 3 heuristic walks each, 40 steps, 3,592 samples.
- Evaluation: 40 other apps, 3 seeds each (120 runs per row). The model never saw these apps. Same step budget, same seeds, same depth limit (5) for both walkers.

Table: results on the 70 generated benchmark apps, 40 of them held out from training.

| Steps | Heuristic screens | Ranker screens | Heuristic findings | Ranker findings |
| ---: | ---: | ---: | ---: | ---: |
| 15 | 8.98 | 10.59 | 0.63 | 0.85 |
| 30 | 14.29 | 16.21 | 1.08 | 1.38 |
| 60 | 21.03 | 21.98 | 1.70 | 1.88 |

The ranker reaches more screens and more findings in the same steps. The gain is largest at small budgets and shrinks as the budget grows, because both walkers end up visiting most of a small app.
