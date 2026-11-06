// A small learned action ranker for `shipvo explore`. Pure TypeScript, no service, no dependencies.
// It scores an action from anonymous features and learns whether the action reached a new screen or a finding.
// Features never hold app content: no label text, no screen text, no values. Only roles, counts and word classes.

export type ActionInfo = {
  kind: "tap" | "type";
  role: string;
  name: string;
  nth: number;
  invalid: boolean;
  risky: boolean;
  depth: number;
  /** Actions still untried on this screen, including this one. */
  left: number;
  /** Actions this screen already had, tried or not. */
  total: number;
  /** Times the screen was acted on so far. */
  visits: number;
  /** Position of this action in the screen's list, 0 is first. */
  index: number;
};

const ROLES = ["button", "link", "tab", "checkbox", "switch", "radio", "menuitem", "textbox", "searchbox"];
/** Word classes. A label only sets a flag; the text itself is never kept. */
const CLASSES: [string, RegExp][] = [
  ["go_on", /\b(next|continue|submit|save|done|go|start|begin|confirm|apply|sign ?(in|up)|log ?in|register|pay|checkout|place)\b/i],
  ["open", /\b(open|view|details?|more|see|show|read|browse|explore|learn)\b/i],
  ["place", /\b(settings?|profile|account|home|menu|help|about|orders?|cart|search|feed|history|inbox|messages?|notifications?)\b/i],
  ["add", /\b(add|new|create|compose|upload|invite)\b/i],
  ["toggle", /\b(filter|sort|toggle|enable|disable|mute|like|favou?rite|star|follow|select|all|none)\b/i],
  ["dismiss", /\b(back|close|dismiss|skip|later|no thanks|not now|ok|cancel)\b/i],
];

export const FEATURES: string[] = [
  ...ROLES.map((r) => `role:${r}`),
  ...CLASSES.map(([c]) => `word:${c}`),
  "kind:type", "type:invalid", "risky", "unnamed", "nth>0", "words>2",
  "depth", "left", "total", "visits", "index", "first", "last", "only",
];

/** Anonymous feature vector of an action, scaled to roughly 0..1. */
export function features(a: ActionInfo): number[] {
  const words = a.name.split(/\s+/).filter(Boolean).length;
  const f: Record<string, number> = {
    "kind:type": a.kind === "type" ? 1 : 0, "type:invalid": a.invalid ? 1 : 0, risky: a.risky ? 1 : 0,
    unnamed: a.name ? 0 : 1, "nth>0": a.nth > 0 ? 1 : 0, "words>2": words > 2 ? 1 : 0,
    depth: Math.min(a.depth, 6) / 6, left: Math.min(a.left, 12) / 12, total: Math.min(a.total, 12) / 12, visits: Math.min(a.visits, 12) / 12,
    index: a.total > 1 ? a.index / (a.total - 1) : 0, first: a.index === 0 ? 1 : 0, last: a.index === a.total - 1 ? 1 : 0, only: a.total === 1 ? 1 : 0,
  };
  for (const r of ROLES) f[`role:${r}`] = a.role === r ? 1 : 0;
  for (const [c, re] of CLASSES) f[`word:${c}`] = re.test(a.name) ? 1 : 0;
  return FEATURES.map((k) => f[k] ?? 0);
}

/** One recorded action. `reward` is 1 when it reached a new screen or a new finding, else 0. */
export type Sample = { x: number[]; y: 0 | 1 };

export type RankerModel = { version: 1; features: string[]; weights: number[]; bias: number; trained: number };

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export class Ranker {
  constructor(readonly model: RankerModel) {
    if (model.features.length !== FEATURES.length || model.features.some((f, i) => f !== FEATURES[i])) throw new Error("ranker: the model was trained with a different feature list");
  }
  /** Chance, 0 to 1, that the action reaches a new screen or a finding. */
  score(a: ActionInfo): number {
    const x = features(a);
    return sigmoid(this.model.bias + x.reduce((s, v, i) => s + v * this.model.weights[i]!, 0));
  }
  toJSON(): RankerModel { return this.model; }
  static from(json: unknown): Ranker {
    const m = json as RankerModel;
    if (!m || m.version !== 1 || !Array.isArray(m.weights) || !Array.isArray(m.features) || m.weights.length !== m.features.length || m.weights.some((w) => !Number.isFinite(w)) || !Number.isFinite(m.bias)) throw new Error("ranker: not a valid ranker model");
    return new Ranker(m);
  }
}

/** Logistic regression by full-batch gradient descent with L2. Deterministic: no random numbers. */
export function train(samples: Sample[], o: { epochs?: number; rate?: number; l2?: number } = {}): Ranker {
  const epochs = o.epochs ?? 300, rate = o.rate ?? 0.5, l2 = o.l2 ?? 0.001;
  const n = FEATURES.length; const w = new Array<number>(n).fill(0);
  const pos = samples.filter((s) => s.y).length;
  // Start the bias at the base rate so early steps are not spent on it.
  let b = samples.length && pos && pos < samples.length ? Math.log(pos / (samples.length - pos)) : 0;
  for (let e = 0; e < epochs && samples.length; e++) {
    const gw = new Array<number>(n).fill(0); let gb = 0;
    for (const s of samples) {
      const err = sigmoid(b + s.x.reduce((t, v, i) => t + v * w[i]!, 0)) - s.y;
      for (let i = 0; i < n; i++) gw[i]! += err * s.x[i]!;
      gb += err;
    }
    for (let i = 0; i < n; i++) w[i]! -= rate * (gw[i]! / samples.length + l2 * w[i]!);
    b -= rate * (gb / samples.length);
  }
  return new Ranker({ version: 1, features: [...FEATURES], weights: w.map((v) => Math.round(v * 1e6) / 1e6), bias: Math.round(b * 1e6) / 1e6, trained: samples.length });
}
