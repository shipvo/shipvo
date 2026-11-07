// No model ships: on held-out apps the trained ranker did not beat the algorithm (docs/lumi-ranker.md).
// scripts/lumi/train.mjs writes a model here. Only commit one that wins the benchmark.
import type { RankerModel } from "./ranker.js";

export const RANKER_MODEL: RankerModel | null = null;
