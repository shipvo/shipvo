import { describe, expect, it } from "vitest";
import { walk } from "../src/explore.js";
import { runFlows } from "../src/flows.js";
// @ts-expect-error plain ES module script, no types
import { SPEC_APPS, specDriver } from "../../../scripts/lumi/spec-app.mjs";
// @ts-expect-error plain ES module script, no types
import { runApp, runSpecApps, summarize, table } from "../../../scripts/lumi/bench-core.mjs";

const engine = { walk, runFlows };
type Bug = { id: string; kind: string };
type App = { id: string; heldOut: boolean; bugs: Bug[]; bugFlags: Record<string, string> };
const apps = SPEC_APPS as App[];

describe("lumi bench", () => {
  it("gives identical output for the same seed", async () => {
    const a = await runSpecApps(engine, { budgets: [50, 200], seed: 7 });
    const b = await runSpecApps(engine, { budgets: [50, 200], seed: 7 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(table(a)).toBe(table(b));
  });

  it("marks at least one app as held out and reports both sets", async () => {
    expect(apps.some((a) => a.heldOut)).toBe(true);
    expect(apps.some((a) => !a.heldOut)).toBe(true);
    const s = summarize(await runSpecApps(engine, { budgets: [50], seed: 1 })) as { set: string }[];
    expect(s.map((x) => x.set).sort()).toEqual(["held out", "tuning"]);
  });

  it("never spends more actions than the budget", async () => {
    for (const r of (await runSpecApps(engine, { budgets: [10, 50], seed: 1 })) as { budget: number; stepsUsed: number }[]) expect(r.stepsUsed).toBeLessThanOrEqual(r.budget);
  });

  it("finds nothing when the bugs are off", async () => {
    for (const app of apps) {
      const r = await runApp(engine, { id: app.id, makeDriver: () => specDriver(app, new Set()), bugs: app.bugs, budget: 1000, seed: 1 });
      expect(r.bugsFound, app.id).toBe(0);
    }
  });

  for (const app of apps) for (const bug of app.bugs) {
    it(`finds ${bug.id} (${bug.kind}) with a large budget, and only that one`, async () => {
      const flag = app.bugFlags[bug.id]!;
      const r = await runApp(engine, { id: app.id, makeDriver: () => specDriver(app, new Set([flag])), bugs: app.bugs, budget: 1000, seed: 1 });
      expect(r.bugIds).toEqual([bug.id]);
    });
  }
});
