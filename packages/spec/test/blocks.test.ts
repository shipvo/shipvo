import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderScreen, createApp, validate, describeTree, unlabelled } from "../src/index.js";
import type { ScreenNode } from "../src/index.js";

const spec = JSON.parse(readFileSync(new URL("./fixtures/render-today.json", import.meta.url), "utf8"));
const all = (n: ScreenNode): ScreenNode[] => [n, ...n.children.flatMap(all)];
const html = (style: "android" | "ios") => {
  const r = renderScreen(spec, { style });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};
const start = () => {
  const r = createApp(spec);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.app;
};
const names = (app: ReturnType<typeof start>) => {
  const r = app.render();
  if (!r.ok) throw new Error("render failed");
  return all(r.tree).map((n) => n.name);
};

describe("validator", () => {
  it("accepts the Today fixture", () => expect(validate(spec).errors).toEqual([]));
  for (const type of ["toggle", "segmented"]) {
    it(`errors with path and suggestion for a ${type} without a label`, () => {
      const s = structuredClone(spec);
      s.screens[0].body = [{ type, bind: "state.alerts", options: ["a"] }];
      const e = validate(s).errors;
      expect(e).toHaveLength(1);
      expect(e[0]!.path).toBe("$.screens[0].body[0]");
      expect(e[0]!.fix).toContain("label");
    });
  }
  it("errors for a missing bind, an undeclared state key and missing options", () => {
    const s = structuredClone(spec);
    s.screens[0].body = [{ type: "toggle", label: "A" }, { type: "toggle", label: "B", bind: "state.nope" }, { type: "segmented", label: "C", bind: "state.period" }];
    expect(validate(s).errors.map((e: { path: string }) => e.path)).toEqual([
      "$.screens[0].body[0].bind", "$.screens[0].body[1].bind", "$.screens[0].body[2].options"
    ]);
  });
});

describe("blocks", () => {
  for (const style of ["android", "ios"] as const) {
    it(`renders every block in ${style} style with names`, () => {
      const r = html(style);
      expect(unlabelled(r.tree)).toEqual([]);
      const n = names(start());
      expect(n).toContain("Revenue today: 1250 EUR, +12%");
      expect(n).toContain("Period: day");
      expect(n).toContain("Monthly goal: 40%");
      expect(n).toContain("Goal ring: 75%");
      expect(n).toContain("Failed payment alerts: off");
      expect(n).toContain("Settings");
      expect(r.tree.children[0]!.children.map((c) => c.block)).toEqual(expect.arrayContaining(["stat", "segmented", "card", "divider", "section", "list"]));
      for (const m of ['role="switch"', 'role="radio"', 'role="separator"', 'aria-valuenow="40"', "<circle", 'aria-label="Settings"']) expect(r.html).toContain(m);
    });
  }
  it("styles differ between Android and iOS", () => {
    const a = html("android"), i = html("ios");
    expect(describeTree(a.tree)).toBe(describeTree(i.tree));
    expect(a.html).not.toBe(i.html);
  });
  it("renders card variants", () => {
    for (const variant of ["plain", "outlined", "filled"]) {
      const s = structuredClone(spec);
      s.screens[0].body = [{ type: "card", variant, label: "C", children: [{ type: "text", value: "x" }] }];
      const r = renderScreen(s);
      expect(r.ok && r.html).toContain('aria-label="C"');
    }
  });
});

describe("controls", () => {
  it("toggling updates state and the tree", () => {
    const app = start();
    expect(app.toggle("Failed payment alerts")).toEqual({ ok: true, value: true });
    expect(app.state.alerts).toBe(true);
    expect(names(app)).toContain("Failed payment alerts: on");
    expect(app.toggle("Failed payment alerts", false)).toEqual({ ok: true, value: false });
    expect(names(app)).toContain("Failed payment alerts: off");
    expect(app.toggle("Nope").ok).toBe(false);
  });
  it("selecting a segment updates state and the tree", () => {
    const app = start();
    expect(app.select("Period", "week").ok).toBe(true);
    expect(app.state.period).toBe("week");
    const r = app.render();
    if (!r.ok) throw new Error("render failed");
    const group = all(r.tree).find((n) => n.role === "radiogroup")!;
    expect(group.name).toBe("Period: week");
    expect(group.children.map((c) => [c.name, c.props?.checked])).toEqual([["day", false], ["week", true], ["month", false]]);
    expect(app.select("Period", "year").ok).toBe(false);
  });
});

describe("sheet navigation", () => {
  for (const style of ["android", "ios"] as const) {
    it(`opens with navigate and closes with back (${style})`, () => {
      const r = createApp(spec, { style });
      if (!r.ok) throw new Error("bad");
      const app = r.app;
      expect(app.press("Details").ok).toBe(true);
      expect(app.screen).toBe("details");
      const open = app.render();
      if (!open.ok) throw new Error("render failed");
      const dialog = open.tree.children[0]!;
      expect([dialog.role, dialog.name]).toEqual(["dialog", "Details"]);
      expect(dialog.children.map((c) => c.name)).toEqual(["Revenue so far today.", "Done", "Close"]);
      expect(open.html).toContain('aria-modal="true"');
      expect(app.press("Done").ok).toBe(true);
      expect(app.screen).toBe("today");
      expect(app.press("Details").ok).toBe(true);
      expect(app.press("Close").ok).toBe(true);
      expect(app.screen).toBe("today");
      expect(app.back().ok).toBe(false);
    });
  }
  it("navigate with presentation sheet in an action opens a plain screen as a sheet", () => {
    const s = structuredClone(spec);
    s.screens.push({ id: "plain", title: "Plain", body: [{ type: "text", value: "hi" }] });
    s.actions = { open: { description: "Open it.", do: [{ navigate: "plain", presentation: "sheet" }] } };
    const r = createApp(s);
    if (!r.ok) throw new Error("bad");
    expect(r.app.call("open").ok).toBe(true);
    const out = r.app.render();
    expect(out.ok && out.tree.children[0]!.role).toBe("dialog");
  });
});
