import { describe, it, expect } from "vitest";
import { renderScreen, validate } from "../src/index.js";
import { vectorSvg } from "../src/vector.js";
import type { ScreenNode } from "../src/index.js";

const gauge = (extra: Record<string, unknown> = {}, theme?: Record<string, unknown>) => ({
  spec: "shipvo.app/v0", app: { id: "gauge", name: "Gauge" }, ...(theme ? { theme } : {}),
  state: { level: { type: "number", default: 40 } },
  screens: [{ id: "h", body: [{
    type: "vector", label: "Battery", value: "{{ state.level }}%", width: 120, height: 40, motion: { enter: "fade", change: "pulse" }, ...extra,
    shapes: [
      { shape: "linearGradient", id: "g1", stops: [{ offset: 0, color: "#0B5FFF" }, { offset: 1, color: "#047857" }] },
      { shape: "rect", x: 0, y: 0, width: 100, height: 20, rx: 4, fill: "#eee" },
      { shape: "rect", x: 0, y: 0, width: "{{ state.level }}", height: 20, rx: 4, fill: "url(#g1)" },
      { shape: "circle", cx: 110, cy: 10, r: 8, fill: "red" },
      { shape: "path", d: "M 0 30 L 100 30", stroke: "#000" },
      { shape: "text", x: 0, y: 38, text: "{{ state.level }}%", fontSize: 10 }
    ]
  }] }]
});
const render = (s: unknown, o = {}) => {
  const r = renderScreen(s, { style: "ios", ...o });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};
const find = (n: ScreenNode): ScreenNode | undefined => (n.block === "vector" ? n : n.children.map(find).find(Boolean));

describe("vector validation", () => {
  it("accepts a gauge", () => expect(validate(gauge()).errors).toEqual([]));
  it("rejects an unknown shape with a path", () => {
    const s = gauge();
    (s.screens[0]!.body[0] as any).shapes[1].shape = "star";
    const e = validate(s).errors[0]!;
    expect(e.path).toBe("$.screens[0].body[0].shapes[1].shape");
    expect(e.fix).toContain("circle");
  });
  it("rejects a missing label", () => {
    const s = gauge();
    delete (s.screens[0]!.body[0] as any).label;
    expect(validate(s).errors[0]!.path).toBe("$.screens[0].body[0].label");
  });
  it("rejects an unknown motion", () => {
    expect(validate(gauge({ motion: { enter: "spin" } })).errors[0]!.path).toBe("$.screens[0].body[0].motion.enter");
  });
});

describe("vector render", () => {
  it("shows label and value in the tree and draws the shapes", () => {
    const r = render(gauge());
    const v = find(r.tree)!;
    expect(v.name).toBe("Battery: 40%");
    expect(r.html).toContain('<rect x="0" y="0" width="40"');
    expect(r.html).toContain("<linearGradient");
    expect(r.html).toContain("<circle");
  });
  it("changes the drawing when the value changes", () => {
    const r = render(gauge(), { state: { level: 75 } });
    expect(find(r.tree)!.name).toBe("Battery: 75%");
    expect(r.html).toContain('width="75"');
    expect(r.html).not.toContain('width="40"');
  });
  it("drops unsafe colours and paths", () => {
    const r = render(gauge({ shapes: [{ shape: "path", d: "M0 0 <script>", fill: "red\" onload=\"x" }] }));
    expect(r.html).not.toContain("<script>");
    expect(r.html).not.toContain("onload");
  });
});

describe("motion", () => {
  it("adds animation fields and CSS", () => {
    const r = render(gauge());
    expect(find(r.tree)!.props!.motion).toMatchObject({ enter: "fade", change: "pulse", duration: 240 });
    expect(r.html).toContain("animation:sv-fade");
  });
  it("lively theme is longer", () => {
    expect(find(render(gauge({}, { motion: "lively" })).tree)!.props!.motion).toMatchObject({ duration: 400 });
  });
  it("theme motion none produces no animation fields", () => {
    const r = render(gauge({}, { motion: "none" }));
    expect(find(r.tree)!.props!.motion).toBeUndefined();
    expect(r.html).not.toContain("animation:");
  });
  it("reduce-motion produces no animation fields", () => {
    const r = render(gauge(), { reduceMotion: true });
    expect(find(r.tree)!.props!.motion).toBeUndefined();
    expect(r.html).not.toContain("animation:");
  });
  it("works on any block", () => {
    const s = gauge();
    (s.screens[0]!.body as any[]).push({ type: "text", value: "hi", motion: { enter: "slide" } });
    expect(render(s).html).toContain("sv-slide 240ms");
  });
});

describe("circle dash", () => {
  it("draws part of the outline from the top", () => {
    const svg = vectorSvg(10, 10, [{ shape: "circle", cx: 5, cy: 5, r: 4, dash: 25 }], "ring");
    expect(svg).toContain('stroke-dasharray="25 100"');
    expect(svg).toContain('pathLength="100"');
    expect(svg).toContain('transform="rotate(-90 5 5)"');
  });
});
