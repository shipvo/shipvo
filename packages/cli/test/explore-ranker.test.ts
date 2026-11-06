import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { features, FEATURES, parseSamples, Ranker, train, type ActionInfo } from "../src/explore-ranker.js";
import { walk, trainCommand, readRanker } from "../src/explore.js";
import { benchApp, benchmark, run } from "./bench/apps.js";

const act = (o: Partial<ActionInfo> = {}): ActionInfo => ({ kind: "tap", role: "button", name: "Next", nth: 0, invalid: false, risky: false, depth: 1, left: 3, total: 4, visits: 0, index: 1, ...o });

describe("ranker features", () => {
  it("hold no app content", () => {
    const a = features(act({ name: "Alice Smith's secret order 4417" })), b = features(act({ name: "Bob Jones's other order 9001" }));
    expect(a).toEqual(b);
    expect(a.length).toBe(FEATURES.length);
    expect(a.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
    expect(features(act({ name: "Continue" }))).not.toEqual(features(act({ name: "Close" })));
  });
});

describe("ranker model", () => {
  it("learns a simple rule and survives a JSON round trip", () => {
    const xs = [features(act({ name: "Continue" })), features(act({ name: "Close" }))];
    const r = train(Array.from({ length: 40 }, (_, i) => ({ x: xs[i % 2]!, y: (i % 2 ? 0 : 1) as 0 | 1 })));
    const back = Ranker.from(JSON.parse(JSON.stringify(r)));
    expect(back.score(act({ name: "Continue" }))).toBeGreaterThan(0.8);
    expect(back.score(act({ name: "Close" }))).toBeLessThan(0.2);
    expect(train([]).score(act())).toBeCloseTo(0.5);
  });
  it("rejects a model that does not match the feature list", () => {
    expect(() => Ranker.from({ version: 1, features: ["x"], weights: [0], bias: 0, trained: 0 })).toThrow(/different feature list/);
    expect(() => Ranker.from({ version: 2 })).toThrow(/not a valid/);
  });
});

describe("ranker in the walker", () => {
  it("records one sample per step and repeats with a seed", async () => {
    const app = benchApp(5); const got: number[][] = [];
    const r = await walk(app.make(), { settleMs: 1, maxSteps: 12, onSample: (s) => got.push(s.x) });
    expect(got.length).toBe(r.steps);
    const ranker = train((await run(benchApp(5), 30, 1)).samples);
    const a = await run(benchApp(6), 20, 3, ranker), b = await run(benchApp(6), 20, 3, ranker);
    expect({ ...a, samples: 0 }).toEqual({ ...b, samples: 0 });
  });
  it("rejects bad sample lines with the line number", () => {
    const ok = JSON.stringify({ x: FEATURES.map(() => 0), y: 1 });
    expect(parseSamples(ok + "\n\n" + ok)).toHaveLength(2);
    expect(() => parseSamples(ok + "\nnot json")).toThrow(/line 2: not valid JSON/);
    expect(() => parseSamples(JSON.stringify({ x: [1], y: 1 }))).toThrow(/line 1: x must be a list/);
    expect(() => parseSamples(JSON.stringify({ x: FEATURES.map(() => "a"), y: 1 }))).toThrow(/finite/);
    expect(() => parseSamples(JSON.stringify({ x: FEATURES.map(() => 0), y: 2 }))).toThrow(/y must be 0 or 1/);
  });
  it("fails clearly on bad files and flags", () => {
    const dir = mkdtempSync(join(tmpdir(), "rk-")); const f = (n: string, t: string) => { const p = join(dir, n); writeFileSync(p, t); return p; };
    expect(() => trainCommand({ train: "true" })).toThrow(/--train needs a samples file/);
    expect(() => trainCommand({ train: f("s.jsonl", ""), "ranker-out": "true" })).toThrow(/--ranker-out needs a file/);
    expect(() => trainCommand({ train: join(dir, "none") })).toThrow(/--train: cannot read/);
    expect(() => trainCommand({ train: f("e.jsonl", ""), "ranker-out": join(dir, "o.json") })).toThrow(/empty/);
    expect(() => readRanker(join(dir, "none"))).toThrow(/--ranker: cannot read/);
    expect(() => readRanker(f("bad.json", "{oops"))).toThrow(/is not a ranker model/);
    expect(() => readRanker(f("wrong.json", "{}"))).toThrow(/is not a ranker model/);
  });
  it("handles a screen with total 0", () => {
    const v = features(act({ total: 0, index: 0 }));
    expect(v).toHaveLength(FEATURES.length);
    expect(v.every(Number.isFinite)).toBe(true);
  });
  it("reaches more screens and findings than the heuristic in the same steps on held-out benchmark apps", async () => {
    const b = await benchmark([15, 30, 60]);
    if (process.env.SHOW_BENCH) console.log(JSON.stringify(b.rows));
    for (const row of b.rows) {
      expect(row.ranker.screens).toBeGreaterThan(row.heuristic.screens);
      expect(row.ranker.findings).toBeGreaterThanOrEqual(row.heuristic.findings);
    }
  }, 60000);
});
