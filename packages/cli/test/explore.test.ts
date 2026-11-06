import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walk, elements, changedRoutes, renderMarkdown, explore, type Driver, type Reply } from "../src/explore.js";

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

describe("walk errors", () => {
  it("reports errors raised while the app loads", async () => {
    const { driver } = fixture();
    const open = driver.open; let first = true;
    driver.open = async () => { const r = await open(); if (first) { first = false; loadErr = true; } return r; };
    let loadErr = false; const errs = driver.errors;
    driver.errors = async () => { if (loadErr) { loadErr = false; return ["start boom"]; } return errs(); };
    const r = await walk(driver);
    const f = r.findings.find((x) => x.message.includes("start boom"));
    expect(f?.kind).toBe("error");
    expect(f?.steps).toEqual([{ action: "open" }]);
  });

  it("reports errors raised by a route deep link", async () => {
    const { driver } = fixture();
    const openUrl = driver.openUrl; let queued = false; const errs = driver.errors;
    driver.openUrl = async (u) => { queued = true; return openUrl(u); };
    driver.errors = async () => { if (queued) { queued = false; return ["route boom"]; } return errs(); };
    const r = await walk(driver, { routes: ["app://settings"] });
    expect(r.findings.find((x) => x.message.includes("route boom"))?.steps).toEqual([{ action: "open" }, { action: "open_url", url: "app://settings" }]);
  });

  it("keeps earlier findings when a step throws", async () => {
    const { driver } = fixture();
    const tap = driver.tap; let n = 0;
    driver.tap = async (ref) => { if (++n === 3) throw new Error("simulator /act -> 500"); return tap(ref); };
    const r = await walk(driver);
    expect(r.error).toContain("500");
    expect(r.stoppedEarly).toContain("the walk failed");
    expect(r.findings.length).toBeGreaterThan(0);
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

describe("accessibility findings", () => {
  const drv = (screen: string, sizes: Record<string, [number, number]>): Driver => ({
    open: async () => ({ ok: true, screen }), openUrl: async () => ({ ok: true, screen }), tap: async () => ({ ok: true, screen, delivery: "delivered" }),
    back: async () => ({ ok: true, screen }), errors: async () => [], sizes: async () => sizes,
  });
  it("flags a 20 px button and not a 48 px one", async () => {
    const r = await walk(drv(`- button "Tiny" [ref=e1]\n- button "Fine" [ref=e2]`, { e1: [20, 20], e2: [48, 48] }));
    const f = r.findings.filter((x) => x.kind === "small_target");
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toContain("Tiny");
    expect(f[0]!.steps).toEqual([{ action: "open" }]);
    expect(renderMarkdown(r)).toContain("Small target");
  });
  it("uses 44 for the ios skin", async () => {
    const d = drv(`- button "Mid" [ref=e1]`, { e1: [46, 46] });
    expect((await walk(d)).findings.filter((x) => x.kind === "small_target")).toHaveLength(1);
    expect((await walk(d, { skin: "ios" })).findings.filter((x) => x.kind === "small_target")).toHaveLength(0);
  });
  it("flags two buttons named Add once", async () => {
    const r = await walk(drv(`- button "Add" [ref=e1]\n- button "Add" [ref=e2]\n- button "Add" [ref=e3]`, {}));
    expect(r.findings.filter((x) => x.kind === "duplicate_name")).toHaveLength(1);
  });
  it("skips the size check when sizes() throws", async () => {
    const d = { ...drv(`- button "Tiny" [ref=e1]`, {}), sizes: async () => { throw new Error("unknown action 'sizes'"); } };
    const r = await walk(d);
    expect(r.findings.filter((x) => x.kind === "small_target")).toHaveLength(0);
    expect(r.stoppedEarly).toBeNull();
  });
});

describe("explore --json", () => {
  it("exits 2 with an error envelope when shipvo.json is missing", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => { logs.push(a.join(" ")); });
    vi.spyOn(process, "cwd").mockReturnValue(mkdtempSync(join(tmpdir(), "explore-json-")));
    const code = await explore(["--json"]);
    vi.restoreAllMocks();
    expect(code).toBe(2);
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0]!)).toMatchObject({ ok: false, code: "error" });
  });
  it("prints one envelope with findings and exits 1 with --fail-on-findings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "explore-json-"));
    writeFileSync(join(dir, "shipvo.json"), JSON.stringify({ appId: "a", name: "A", controlPlane: "https://example.com", publicKey: "k" }));
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => { logs.push(a.join(" ")); });
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    vi.spyOn(globalThis, "fetch").mockImplementation((async () => Response.json({ ok: true, screen: '- heading "Home" [ref=e1]', errors: [] })) as never);
    const code = await explore(["--json", "--sim", "http://sim.test", "--out", join(dir, "r"), "--fail-on-findings"]);
    vi.restoreAllMocks();
    expect(code).toBe(1);
    expect(logs).toHaveLength(1);
    const doc = JSON.parse(logs[0]!);
    expect(doc).toMatchObject({ ok: false, code: "findings" });
    expect(doc.data.findings[0].kind).toBe("dead_end");
    expect(doc.next.length).toBeGreaterThan(0);
  });
});

describe("--changed-from", () => {
  it("turns a fake diff into routes: changed, non-dynamic screens only", () => {
    const diff = () => ["app/settings.tsx", "app/item/[id].tsx", "app/_layout.tsx", "app/index.tsx", "README.md", "app/settings.test.tsx"];
    expect(changedRoutes("abc", diff)).toEqual(["/settings", "/"]);
  });
  it("walks only the changed screens and does not follow links off them", async () => {
    const { driver, taps } = fixture();
    const visited: string[] = [];
    const wrapped: Driver = { ...driver, async openUrl(url) { visited.push(url); return driver.openUrl(url === "/settings" ? "app://settings" : url); } };
    const r = await walk(wrapped, { routes: changedRoutes("abc", () => ["app/settings.tsx", "app/item/[id].tsx"]), onlyRoutes: true, maxDepth: 1 });
    expect(visited).toEqual(["/settings"]);
    expect(taps).toEqual(["Deeper"]);
    expect(r.stoppedEarly).toBeNull();
    expect(r.findings.some((f) => f.screen.includes('heading "Home"'))).toBe(false);
    expect(taps).not.toContain("Crash");
  });
  it("without the flag, home and every route are still walked", async () => {
    const { driver } = fixture();
    const r = await walk(driver, { app: "fx" });
    expect(r.screens).toBeGreaterThanOrEqual(4);
    expect(r.findings.some((f) => f.kind === "error")).toBe(true);
  });
});
