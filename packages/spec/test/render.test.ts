import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderScreen, describeTree, unlabelled, toSnapshot } from "../src/index.js";
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

  it("cannot be broken out of by a hostile font family", () => {
    const evil = structuredClone(spec);
    evil.theme.font = { ...(evil.theme.font ?? {}), family: `x";"><img src=x onerror=alert(1)>`, display: `y'"><script>alert(1)</script>` };
    for (const style of ["android", "ios"] as const) {
      const r = renderScreen(evil, { style, data });
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      expect(r.html).not.toContain("<img src=x");
      expect(r.html).not.toContain("onerror=alert(1)>");
      expect(r.html.match(/<img /g)?.length ?? 0).toBe((JSON.stringify(spec).match(/"type":\s*"image"/g) ?? []).length);
      expect(r.html).not.toContain("<script");
      expect(r.html).not.toContain("onerror=alert(1)>");
    }
  });

  it("does not accept row as a direction", () => {
    const s = structuredClone(spec);
    s.screens[0].body = [{ type: "stack", direction: "row", children: [{ type: "text", value: "a" }] }];
    const r = renderScreen(s, { data });
    if (r.ok) expect(r.html).toContain("flex-direction:column");
  });

  it("reads when with and without {{ }}, and from as a {{ }} expression", () => {
    const s = structuredClone(spec);
    s.screens[0].body = [
      { type: "text", value: "plain-on", when: "1 == 1" },
      { type: "text", value: "braced-on", when: "{{ 1 == 1 }}" },
      { type: "text", value: "plain-off", when: "1 == 2" },
      { type: "text", value: "braced-off", when: "{{ 1 == 2 }}" },
      { type: "list", label: "Big", from: "{{ data.catches.filter(c, c.weight > 2) }}", item: { title: "{{ item.species }}" } }
    ];
    const r = renderScreen(s, { data });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const names = all(r.tree).map((n) => n.name);
    expect(names).toContain("plain-on");
    expect(names).toContain("braced-on");
    expect(names).not.toContain("plain-off");
    expect(names).not.toContain("braced-off");
    expect(names).toContain("Bass");
    expect(names).not.toContain("Mackerel");
  });

  it("writes the tree in the simulator's screen format that @shipvo/test parses", () => {
    const r = renderScreen(spec, { data });
    if (!r.ok) throw new Error("render failed");
    const snap = toSnapshot(r.tree);
    const lines = snap.split("\n");
    expect(lines[0]).toMatch(/^- main ".+" \[ref=e1\]$/);
    expect(lines.every((l) => /^ *- [\w-]+( "(?:[^"\\]|\\.)*")? \[ref=e\d+\]$/.test(l))).toBe(true);
    expect(snap).toContain('listitem "Mackerel, North pier, 1.3 kg"');
  });
});
