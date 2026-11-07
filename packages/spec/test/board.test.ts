import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createApp, describeTree, renderScreen, toSnapshot, validate } from "../src/index.js";

const spec = JSON.parse(readFileSync(new URL("./fixtures/render-board.json", import.meta.url), "utf8"));
const edit = (fn: (b: Record<string, any>[], s: any) => void) => {
  const s = structuredClone(spec);
  fn(s.screens[0].body, s);
  return validate(s).errors;
};

describe("kanban and timeline validation", () => {
  it("accepts the fixture", () => expect(validate(spec).errors).toEqual([]));
  it("rejects a bad column list with a path and suggestion", () => {
    const e = edit((b) => { b[0]!.columns = []; })[0]!;
    expect(e.path).toBe("$.screens[0].body[0].columns");
    expect(e.fix).toContain("todo");
  });
  it("rejects a card in a column the board does not have", () => {
    const e = edit((_, s) => { s.data.tasks.seed[0].status = "later"; })[0]!;
    expect(e.path).toBe("$.data.tasks.seed[0].status");
    expect(e.fix).toContain("todo, doing, done");
  });
  it("rejects a bad date with a path and suggestion", () => {
    const e = edit((_, s) => { s.data.tasks.seed[1].at = "tomorrow"; })[0]!;
    expect(e.path).toBe("$.data.tasks.seed[1].at");
    expect(e.fix).toContain("2026-11-07");
  });
  it("rejects a missing date and an undeclared move action", () => {
    expect(edit((b) => { delete b[1]!.date; })[0]!.path).toBe("$.screens[0].body[1].date");
    expect(edit((b) => { b[0]!.onMove.action = "nope"; })[0]!.path).toBe("$.screens[0].body[0].onMove.action");
  });
});

describe("kanban and timeline render", () => {
  for (const style of ["android", "ios"] as const) {
    it(`lists every card and entry with refs on ${style}`, () => {
      const r = renderScreen(spec, { style });
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      const snap = toSnapshot(r.tree);
      expect(snap).toMatch(/group "todo, 2 cards" \[ref=e\d+\]/);
      expect(snap).toMatch(/listitem "Buy bait, Worms" \[ref=e\d+\]/);
      expect(snap).toMatch(/listitem "Fix reel" \[ref=e\d+\]/);
      expect(snap).toMatch(/group "2026-11-07" \[ref=e\d+\]/);
      expect(snap).toMatch(/listitem "Tie knots, Practice" \[ref=e\d+\]/);
      expect(snap.indexOf("2026-11-07")).toBeLessThan(snap.indexOf("2026-11-06"));
      expect(r.html).toContain('aria-label="Task board"');
      expect(r.html).toContain('aria-label="History"');
      expect(r.html).toContain("Buy bait");
      expect(describeTree(r.tree)).toContain("Fix reel");
    });
  }
  it("moving a card runs its declared action", () => {
    const c = createApp(spec);
    if (!c.ok) throw new Error("x");
    expect(c.app.move("Buy bait", "done")).toEqual({ ok: true, value: undefined });
    expect((c.app.data.tasks as any[])[0].status).toBe("done");
    const r = c.app.render();
    if (!r.ok) throw new Error("x");
    expect(toSnapshot(r.tree)).toContain('group "done, 1 card"');
    expect(c.app.move("Buy bait", "nowhere").ok).toBe(false);
    expect(c.app.move("Ghost", "done").ok).toBe(false);
  });
});
