import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderScreen, describeTree, unlabelled } from "../src/index.js";
import type { ScreenNode } from "../src/index.js";

const spec = JSON.parse(readFileSync(new URL("./fixtures/render-demo.json", import.meta.url), "utf8"));
const data = { catches: [{ species: "Mackerel", spot: "North pier", weight: 1.25 }, { species: "Bass", spot: "Mole", weight: 3 }] };
const all = (n: ScreenNode): ScreenNode[] => [n, ...n.children.flatMap(all)];

describe("renderScreen", () => {
  for (const style of ["android", "ios"] as const) {
    it(`renders the fixture in ${style} style with a role and name on every control`, () => {
      const r = renderScreen(spec, { style, data });
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      expect(unlabelled(r.tree)).toEqual([]);
      const nodes = all(r.tree);
      expect(nodes.every((n) => n.role)).toBe(true);
      expect(nodes.filter((n) => n.block === "item").map((n) => n.name)).toEqual(["Mackerel, North pier, 1.3 kg", "Bass, Mole, 3.0 kg"]);
      expect(r.html).toContain(`data-style="${style}"`);
      expect(r.html).toContain('role="listitem"');
      expect(r.html).toContain('aria-label="Catches"');
    });
  }

  it("gives the same tree for both styles and different HTML", () => {
    const a = renderScreen(spec, { style: "android", data });
    const i = renderScreen(spec, { style: "ios", data });
    if (!a.ok || !i.ok) throw new Error("render failed");
    expect(describeTree(a.tree)).toBe(describeTree(i.tree));
    expect(a.html).not.toBe(i.html);
  });

  it("reads theme tokens", () => {
    const dark = structuredClone(spec);
    dark.theme.palette.background = "#0B0F14";
    dark.theme.palette.text = "#F3F6F9"; dark.theme.palette.muted = "#A5B0BF"; dark.theme.palette.surface = "#141A22"; dark.theme.palette.primary = "#7CB0FF";
    const r = renderScreen(dark, { data });
    if (!r.ok) throw new Error("render failed");
    expect(r.html).toContain("#0B0F14");
  });

  it("shows the empty message, computed values and the screen tree text", () => {
    const r = renderScreen(spec, {});
    if (!r.ok) throw new Error("render failed");
    expect(describeTree(r.tree)).toContain('status "No catches yet"');
    expect(describeTree(r.tree)).toContain('status "0 logged"');
  });

  it("hides blocks whose `when` is false", () => {
    const s = structuredClone(spec);
    s.screens[0].body[0].children[0].children[1].when = "{{ 1 > 2 }}";
    const r = renderScreen(s, { data });
    if (!r.ok) throw new Error("render failed");
    expect(describeTree(r.tree)).not.toContain("Today's catches");
  });

  it("refuses invalid specs with the validator's errors", () => {
    const bad = structuredClone(spec);
    bad.screens[0].body[0].children[0].children[0].type = "nope";
    const r = renderScreen(bad, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
    const r2 = renderScreen({ spec: "shipvo.app/v0" }, {});
    expect(r2.ok).toBe(false);
  });

  it("refuses an unknown screen and escapes text", () => {
    expect(renderScreen(spec, { screen: "zzz" }).ok).toBe(false);
    const s = structuredClone(spec);
    s.screens[0].body[0].children[0].children[1].value = "<script>x</script>";
    const r = renderScreen(s, { data });
    if (!r.ok) throw new Error("render failed");
    expect(r.html).not.toContain("<script>");
  });
});
