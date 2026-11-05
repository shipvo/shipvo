import { describe, expect, it } from "vitest";
import { walk, elements, renderMarkdown, type Driver, type Reply } from "../src/explore.js";

// A fixture app: Home has a button that crashes, an unnamed button, a link to Settings and a link to a dead end.
const SCREENS: Record<string, string> = {
  home: `- heading "Home" [ref=e1]\n- button "Crash" [ref=e2]\n- button [ref=e3]\n- button "Settings" [ref=e4]\n- button "Dead end" [ref=e5]`,
  settings: `- heading "Settings" [ref=e1]\n- button "Back" [ref=e2]\n- button "Deeper" [ref=e3]`,
  deeper: `- heading "Deeper" [ref=e1]\n- button "Back" [ref=e2]`,
  dead: `- heading "Nothing here" [ref=e1]`,
};
function fixture() {
  let at = "home"; const stack: string[] = []; let pending: string[] = []; const taps: string[] = [];
  const view = (): Reply => ({ ok: true, screen: SCREENS[at] });
  const driver: Driver = {
    async open() { at = "home"; stack.length = 0; pending = []; return view(); },
    async openUrl(url) { at = url === "app://settings" ? "settings" : at; return view(); },
    async tap(ref) {
      const name = new RegExp(`button "([^"]+)" \\[ref=${ref}\\]`).exec(SCREENS[at]!)?.[1]; taps.push(name ?? "?");
      if (name === "Crash") pending.push("boom is not defined");
      const to = { Settings: "settings", "Dead end": "dead", Deeper: "deeper" }[name ?? ""];
      if (to) { stack.push(at); at = to; }
      return { ...view(), delivery: "delivered" };
    },
    async back() { const p = stack.pop(); if (!p) return { ok: false, error: "no Back button", screen: SCREENS[at] }; at = p; return view(); },
    async errors() { const e = pending; pending = []; return e; },
  };
  return { driver, taps };
}

describe("elements", () => {
  it("lists actionable elements and counts repeated names", () => {
    const els = elements(`- button "Add" [ref=e1]\n- button "Add" [ref=e2]\n- button [ref=e3]:\n- textbox "Name" [ref=e4]\n- button "Off" [disabled] [ref=e5]`);
    expect(els.map((e) => [e.name, e.nth])).toEqual([["Add", 0], ["Add", 1], ["", 0]]);
  });
});

describe("walk", () => {
  it("reports the crash, the unnamed button and the dead end, each with replay steps", async () => {
    const { driver } = fixture();
    const r = await walk(driver, { app: "fx" });
    const by = (k: string) => r.findings.filter((f) => f.kind === k);
    expect(by("error")).toHaveLength(1);
    expect(by("error")[0]!.message).toContain("boom is not defined");
    expect(by("error")[0]!.steps).toEqual([{ action: "open" }, { action: "tap", role: "button", name: "Crash", nth: 0 }]);
    expect(by("unnamed")[0]!.steps).toEqual([{ action: "open" }]);
    expect(by("dead_end")[0]!.steps).toEqual([{ action: "open" }, { action: "tap", role: "button", name: "Dead end", nth: 0 }]);
    expect(r.stoppedEarly).toBeNull();
    // the Settings subtree was walked too, and the walk came back after the dead end
    expect(r.screens).toBeGreaterThanOrEqual(4);
  });

  it("stops at --max-steps and says so", async () => {
    const { driver, taps } = fixture();
    const r = await walk(driver, { maxSteps: 2 });
    expect(taps).toHaveLength(2);
    expect(r.stoppedEarly).toMatch(/max-steps \(2\)/);
  });

  it("stops at --max-depth and says so", async () => {
    const { driver, taps } = fixture();
    const r = await walk(driver, { maxDepth: 1 });
    expect(taps).not.toContain("Deeper");
    expect(r.stoppedEarly).toMatch(/max-depth \(1\)/);
  });

  it("visits routes after the start screen", async () => {
    const { driver } = fixture();
    const r = await walk(driver, { routes: ["app://settings"] });
    expect(r.screens).toBeGreaterThanOrEqual(3);
  });

  it("reports a tap that was not delivered", async () => {
    const { driver } = fixture();
    const tap = driver.tap;
    driver.tap = async (ref) => { const r = await tap(ref); return ref === "e2" ? { ...r, ok: false, delivery: "not_delivered", reason: "covered", error: "covered" } : r; };
    const r = await walk(driver);
    expect(r.findings.find((f) => f.kind === "not_delivered")?.message).toContain("covered");
  });
});

describe("renderMarkdown", () => {
  it("lists the limits, and never says a screen is fine", async () => {
    const empty = renderMarkdown(await walk({ ...fixture().driver, async open() { return { ok: true, screen: `- button "Back" [ref=e1]` }; } }, { maxSteps: 5 }));
    expect(empty).toContain("Simulator limits");
    expect(empty).toMatch(/No findings in 0 steps\./);
    expect(empty).not.toMatch(/\bfine\b|\bno problems\b/i);
    const full = renderMarkdown(await walk(fixture().driver, { app: "fx" }));
    expect(full).toContain("tap button \"Crash\"");
    expect(full).toContain("```json");
  });
});
