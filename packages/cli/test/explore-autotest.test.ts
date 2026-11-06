import { describe, expect, it } from "vitest";
import { walk, describeStep, sampleValue, type Driver, type Reply } from "../src/explore.js";

// A shop app. Sign up needs a valid email before it goes on; Feed fails to load; Orders spins forever; Reports draws nothing.
const SCREENS: Record<string, string> = {
  home: `- heading "Home" [ref=e1]\n- button "Log out" [ref=e2]\n- button "Sign up" [ref=e3]\n- button "Feed" [ref=e4]\n- button "Orders" [ref=e5]\n- button "Reports" [ref=e6]`,
  login: `- heading "Signed out" [ref=e1]\n- button "Sign in" [ref=e2]`,
  signup: `- heading "Sign up" [ref=e1]\n- textbox "Email" [ref=e2]\n- button "Continue" [ref=e3]\n- button "Back" [ref=e4]`,
  bad: `- heading "Sign up" [ref=e1]\n- text: Enter a valid email\n- textbox "Email" [ref=e2]\n- button "Continue" [ref=e3]\n- button "Back" [ref=e4]`,
  welcome: `- heading "Welcome" [ref=e1]\n- button "Profile" [ref=e2]\n- button "Back" [ref=e3]`,
  profile: `- heading "Profile" [ref=e1]\n- button "Back" [ref=e2]`,
  feed: `- heading "Feed" [ref=e1]\n- text: Network request failed\n- button "Back" [ref=e2]`,
  orders: `- heading "Orders" [ref=e1]\n- progressbar [ref=e2]\n- button "Back" [ref=e3]`,
  reports: `- generic [ref=e1]`,
};
function shop(opts: { typing?: boolean } = {}) {
  let at = "home"; let email = ""; const stack: string[] = []; const taps: string[] = []; const typed: [string, boolean][] = [];
  const view = (): Reply => ({ ok: true, screen: SCREENS[at] });
  const go = (to: string) => { stack.push(at); at = to; };
  const submit = () => { if (/^\S+@\S+\.\S+$/.test(email)) go("welcome"); else if (at === "signup") go("bad"); };
  const driver: Driver = {
    async open() { at = "home"; email = ""; stack.length = 0; return view(); },
    async openUrl() { return view(); },
    async tap(ref) {
      const name = new RegExp(`button "([^"]+)" \\[ref=${ref}\\]`).exec(SCREENS[at]!)?.[1] ?? "?"; taps.push(name);
      const to: Record<string, string> = { "Log out": "login", "Sign in": "home", "Sign up": "signup", Feed: "feed", Orders: "orders", Reports: "reports", Profile: "profile" };
      if (name === "Continue") submit(); else if (to[name]) { if (to[name] === "home") stack.length = 0; go(to[name]!); }
      return { ...view(), delivery: "delivered" };
    },
    async back() { const p = stack.pop(); if (!p) return { ok: false, error: "no Back button", screen: SCREENS[at] }; at = p; return view(); },
    async errors() { return []; },
    async snapshot() { return view(); },
  };
  if (opts.typing !== false) driver.type = async (_ref, text, enter) => { typed.push([text, !!enter]); email = text; if (enter) submit(); return view(); };
  return { driver, taps, typed };
}

// Screens the walker from before this change reached on this app (measured by running it on main: 7).
const OLD_SCREENS = 7;
const opts = { settleMs: 1, maxSteps: 100, maxDepth: 4 };

describe("autotest walk", () => {
  it("reaches more screens than the tap-only walker", async () => {
    const r = await walk(shop().driver, opts);
    expect(r.screens).toBeGreaterThan(OLD_SCREENS);
  });
  it("types a valid value, then an invalid one, from the label", async () => {
    const { driver, typed } = shop();
    const r = await walk(driver, opts);
    expect(typed[0]).toEqual(["ada@example.com", false]);
    expect(typed).toContainEqual(["not-an-email", true]);
    expect(r.screens).toBeGreaterThanOrEqual(9);
    expect(sampleValue("Email address", false)).toBe("ada@example.com");
    expect(sampleValue("Phone", true)).toBe("12");
    expect(sampleValue("Quantity", false)).toBe("42");
    expect(describeStep({ action: "type", role: "textbox", name: "Email", nth: 0, text: "x", enter: true })).toBe('type "x" into textbox "Email" and press Enter');
  });
  it("taps risky labels last", async () => {
    const { driver, taps } = shop();
    await walk(driver, opts);
    const firstLogOut = taps.indexOf("Log out");
    expect(firstLogOut).toBeGreaterThan(-1);
    for (const safe of ["Sign up", "Feed", "Orders", "Reports", "Profile", "Continue"]) expect(taps.indexOf(safe)).toBeLessThan(firstLogOut);
  });
  it("fires network_failed, stuck_loading and blank_screen with steps", async () => {
    const r = await walk(shop().driver, opts);
    const by = (k: string) => r.findings.filter((f) => f.kind === k);
    expect(by("network_failed")[0]!.steps).toEqual([{ action: "open" }, { action: "tap", role: "button", name: "Feed", nth: 0 }]);
    expect(by("stuck_loading")[0]!.steps).toEqual([{ action: "open" }, { action: "tap", role: "button", name: "Orders", nth: 0 }]);
    expect(by("blank_screen")[0]!.steps).toEqual([{ action: "open" }, { action: "tap", role: "button", name: "Reports", nth: 0 }]);
  });
  it("reports network errors thrown by the app as network_failed", async () => {
    const d = shop().driver; let once = true;
    d.errors = async () => (once ? (once = false, ["TypeError: Failed to fetch"]) : []);
    const r = await walk(d, opts);
    expect(r.findings.some((f) => f.kind === "network_failed" && f.message.includes("Failed to fetch"))).toBe(true);
  });
  it("does not call a loading screen stuck when it settles", async () => {
    const d = shop().driver;
    d.snapshot = async () => ({ ok: true, screen: SCREENS.profile });
    const r = await walk(d, opts);
    expect(r.findings.some((f) => f.kind === "stuck_loading")).toBe(false);
  });
  it("does not call a settled screen with 'Loading history' text stuck", async () => {
    const d = shop().driver;
    const screen = `- heading "Loading history" [ref=e1]\n- text: Your past orders`;
    d.open = async () => ({ ok: true, screen });
    d.snapshot = async () => ({ ok: true, screen });
    const r = await walk(d, opts);
    expect(r.findings.some((f) => f.kind === "stuck_loading")).toBe(false);
  });
  it("repeats exactly with the same seed", async () => {
    const run = async (seed: number) => { const { driver, taps } = shop(); const r = await walk(driver, { ...opts, seed }); return { taps, f: r.findings.map((x) => x.message) }; };
    expect(await run(7)).toEqual(await run(7));
  });
  it("keeps the report format and the step limit", async () => {
    const { driver, taps } = shop();
    const r = await walk(driver, { ...opts, maxSteps: 3 });
    expect(taps.length).toBeLessThanOrEqual(3);
    expect(r.steps).toBe(3);
    expect(r.stoppedEarly).toMatch(/max-steps \(3\)/);
    expect(Object.keys(r).sort()).toEqual(["app", "error", "findings", "generatedAt", "maxDepth", "maxSteps", "parityLimits", "screens", "steps", "stoppedEarly"]);
  });
});
