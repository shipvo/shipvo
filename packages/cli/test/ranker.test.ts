import { describe, expect, it } from "vitest";
import { walk, type ActionRecord, type Driver, type Reply } from "../src/explore.js";
import { FEATURES, featureVector, predict, train, usable, type RankerModel } from "../src/ranker.js";
import { RANKER_MODEL } from "../src/ranker-weights.js";

const SCREENS: Record<string, string> = {
  home: `- heading "Home" [ref=e1]\n- button "Alpha" [ref=e2]\n- button "Beta" [ref=e3]\n- tab "Gamma" [ref=e4]`,
  a: `- heading "A" [ref=e1]\n- button "Back" [ref=e2]`,
  b: `- heading "B" [ref=e1]\n- button "Back" [ref=e2]`,
  g: `- heading "G" [ref=e1]\n- button "Back" [ref=e2]`,
};
function fixture(): Driver {
  let at = "home";
  const view = (): Reply => ({ ok: true, screen: SCREENS[at] });
  return {
    async open() { at = "home"; return view(); },
    async openUrl() { return view(); },
    async tap(ref) { if (at === "home") at = ({ e2: "a", e3: "b", e4: "g" } as Record<string, string>)[ref] ?? at; return view(); },
    async back() { at = "home"; return view(); },
    async type() { return view(); },
    async errors() { return []; },
  };
}
const order = async (ranker?: RankerModel | null) => {
  const lines: ActionRecord[] = [];
  const report = await walk(fixture(), { seed: 5, settleMs: 0, app: "x", maxSteps: 3, ...(ranker !== undefined ? { ranker } : {}), onAction: (r) => lines.push(r) });
  return { hashes: lines.map((l) => l.action.label_hash), report: { ...report, generatedAt: "" } };
};
const model = (w: Partial<Record<(typeof FEATURES)[number], number>>): RankerModel => ({ version: 1, features: [...FEATURES], bias: 0, weights: FEATURES.map((f) => w[f] ?? 0) });

describe("action ranker", () => {
  it("ships no model, because it did not beat the algorithm", () => {
    expect(RANKER_MODEL).toBeNull();
  });
  it("model off gives the exact old behaviour", async () => {
    const old = await order();
    expect((await order(null)).report).toEqual(old.report);
    expect((await order(null)).hashes).toEqual(old.hashes);
    // A model that scores every action the same keeps the algorithm's order.
    expect((await order(model({}))).hashes).toEqual(old.hashes);
  });
  it("a model can change which action goes first", async () => {
    const off = await order();
    const on = await order(model({ "role:tab": 6, "role:button": -6 }));
    expect(on.hashes[0]).not.toBe(off.hashes[0]);
  });
  it("ignores a model made for another feature list", () => {
    expect(usable({ version: 1, features: ["x"], bias: 0, weights: [1] })).toBe(false);
    expect(usable(model({}))).toBe(true);
    expect(usable(null)).toBe(false);
  });
  it("predicts between 0 and 1 and trains the same way twice", () => {
    const a = { kind: "tap" as const, role: "button", risky: false, invalid_input: false, enter: false, nth: 0, depth: 1, tried: 0, actions: 3, fields: 0 };
    expect(featureVector(a)).toHaveLength(FEATURES.length);
    const p = predict(model({}), a); expect(p).toBeCloseTo(0.5);
    const rows = [
      { x: featureVector(a), y: 1 as const },
      { x: featureVector({ ...a, risky: true }), y: 0 as const },
    ];
    const m1 = train(rows), m2 = train(rows);
    expect(m1).toEqual(m2);
    const t: RankerModel = { version: 1, features: [...FEATURES], ...m1 };
    expect(predict(t, a)).toBeGreaterThan(predict(t, { ...a, risky: true }));
  });
});
