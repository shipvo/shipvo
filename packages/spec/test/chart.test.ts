import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderScreen, validate } from "../src/index.js";
import type { ScreenNode } from "../src/index.js";

const spec = JSON.parse(readFileSync(new URL("./fixtures/render-charts.json", import.meta.url), "utf8"));
const dark = () => {
  const s = structuredClone(spec);
  s.theme = { mode: "dark" };
  return s;
};
const render = (s: unknown) => {
  const r = renderScreen(s, { style: "ios" });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};
const charts = (n: ScreenNode): ScreenNode[] => (n.block === "chart" ? [n] : n.children.flatMap(charts));
const chart = (b: Record<string, unknown>) => ({ spec: "shipvo.app/v0", app: { id: "mini", name: "Mini" }, screens: [{ id: "h", body: [{ type: "chart", from: "a", x: "item.a", y: "item.b", label: "L", kind: "bar", ...b }] }], data: { a: { source: "collection", fields: { a: "text", b: "number" } } } });

describe("chart validation", () => {
  it("accepts the fixture", () => expect(validate(spec).errors).toEqual([]));
  it("rejects an unknown kind with a path and suggestion", () => {
    const e = validate(chart({ kind: "pie" })).errors[0]!;
    expect(e.path).toBe("$.screens[0].body[0].kind");
    expect(e.fix).toContain("line, area, bar, donut");
  });
  it("rejects a missing label with a path and suggestion", () => {
    const spec = chart({});
    delete (spec.screens[0]!.body[0] as Record<string, unknown>).label;
    const e = validate(spec).errors[0]!;
    expect(e.path).toBe("$.screens[0].body[0].label");
    expect(e.fix).toContain("label");
  });
  it("rejects an unknown aggregate", () => {
    expect(validate(chart({ aggregate: "median" })).errors[0]!.path).toBe("$.screens[0].body[0].aggregate");
  });
});

describe("chart render", () => {
  it("groups with sum and writes the data points in the screen tree", () => {
    const names = charts(render(spec).tree).map((c) => c.name);
    expect(names[0]).toBe("Line revenue: Mon 120, Tue 90, Wed 150");
    expect(names[2]).toBe("Bar revenue by team: A Mon 100, B Mon 20, A Tue 90, A Wed 140, B Wed 10");
    expect(names[3]).toBe("Donut share: A 330, B 30");
  });
  it("supports the other aggregates", () => {
    const s = structuredClone(spec);
    const b = s.screens[0].body[0];
    b.aggregate = "avg";
    expect(charts(render(s).tree)[0]!.name).toBe("Line revenue: Mon 60, Tue 90, Wed 75");
    b.aggregate = "count";
    expect(charts(render(s).tree)[0]!.name).toBe("Line revenue: Mon 2, Tue 1, Wed 2");
  });
  for (const mode of ["light", "dark"]) {
    it(`draws SVG with theme token colours in ${mode}`, () => {
      const html = render(mode === "dark" ? dark() : spec).html;
      const pal = mode === "dark" ? ["#7CB0FF", "#FF9A7A"] : ["#0B5FFF", "#C2410C"];
      for (const kind of ["line", "area", "bar", "donut"]) expect(html).toContain(`data-chart="${kind}"`);
      expect(html).toContain("<polyline");
      expect(html).toContain("<polygon");
      expect(html).toContain("<rect");
      expect(html).toContain("<circle");
      for (const c of pal) expect(html).toContain(c);
      expect(html).not.toContain("<animate");
    });
  }
});
