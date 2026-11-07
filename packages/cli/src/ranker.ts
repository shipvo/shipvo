// Lumi action ranker: a small logistic regression over the features in docs/explore-features.md.
// It is trained by scripts/lumi/train.mjs. The walker multiplies its own score by the prediction.
// With no model the walker behaves exactly as before.

const ROLES = ["button", "link", "tab", "checkbox", "switch", "radio", "menuitem", "textbox", "searchbox"];
export const FEATURES = [
  ...ROLES.map((r) => `role:${r}`),
  "kind:type", "risky", "invalid_input", "enter", "nth>0", "depth", "tried_share", "log_actions", "screen_fields",
] as const;

/** What is known about an action before it is taken. No text, only roles, counts and flags. */
export type ActionInput = {
  kind: "tap" | "type"; role: string; risky: boolean; invalid_input: boolean; enter: boolean; nth: number;
  depth: number; tried: number; actions: number; fields: number;
};
export type RankerModel = { version: number; features: string[]; bias: number; weights: number[]; trainedOn?: string };

export function featureVector(a: ActionInput): number[] {
  const roles = ROLES.map((r) => (a.role === r ? 1 : 0));
  return [
    ...roles, a.kind === "type" ? 1 : 0, a.risky ? 1 : 0, a.invalid_input ? 1 : 0, a.enter ? 1 : 0, a.nth > 0 ? 1 : 0,
    Math.min(a.depth, 6) / 6, a.actions ? a.tried / a.actions : 0, Math.log1p(a.actions) / 4, Math.min(a.fields, 4) / 4,
  ];
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Chance in (0, 1) that the action reaches a new screen or shows a finding. */
export function predict(model: RankerModel, a: ActionInput): number {
  const x = featureVector(a);
  let z = model.bias;
  for (let i = 0; i < x.length; i++) z += (model.weights[i] ?? 0) * x[i]!;
  return sigmoid(z);
}

/** A model made for another feature list is ignored, so a stale weights file can never break a run. */
export function usable(model: RankerModel | null | undefined): model is RankerModel {
  return !!model && model.weights.length === FEATURES.length && model.features.join() === FEATURES.join();
}

/** Plain batch gradient descent with L2. Deterministic: same rows, same model. */
export function train(rows: { x: number[]; y: 0 | 1 }[], o: { epochs?: number; rate?: number; l2?: number } = {}): Pick<RankerModel, "bias" | "weights"> {
  const { epochs = 400, rate = 0.5, l2 = 0.01 } = o;
  const d = FEATURES.length; const w = new Array<number>(d).fill(0); let b = 0;
  if (!rows.length) return { bias: b, weights: w };
  for (let e = 0; e < epochs; e++) {
    const g = new Array<number>(d).fill(0); let gb = 0;
    for (const r of rows) {
      let z = b; for (let i = 0; i < d; i++) z += w[i]! * r.x[i]!;
      const err = sigmoid(z) - r.y; gb += err;
      for (let i = 0; i < d; i++) g[i]! += err * r.x[i]!;
    }
    b -= (rate * gb) / rows.length;
    for (let i = 0; i < d; i++) w[i] = w[i]! - rate * (g[i]! / rows.length + l2 * w[i]!);
  }
  return { bias: b, weights: w };
}
