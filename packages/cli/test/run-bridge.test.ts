// Slice 3b of #448: the frame-page bridge answers `tree` over the agent channel, and the tree is equivalent
// (for an agent) to the simulator's. Equivalence = the same role, name, states and textbox value for every interactive element and heading.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startRunServer } from "../src/run";
import { bridgeScript } from "../src/run-bridge";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "../../../apps/tide-and-tackle");
const simDir = resolve(here, "../../sim");
const require = createRequire(join(simDir, "package.json"));
const KEPT = /^\s*- '?(button|link|textbox|searchbox|checkbox|radio|switch|tab|heading) ("(?:[^"\\]|\\.)*")?((?: \[(?:checked|disabled|level=\d|expanded|selected|pressed)(?:=\w+)?\])*)/;
const VALUE = /\]'?: (.*)$/;

/** The sequence the equivalence check compares: role, name, [checked] [disabled] [level] states, and a textbox's value. Refs are left out. */
const interactive = (tree: string): string[] => tree.split("\n").flatMap((l) => {
  const m = KEPT.exec(l); if (!m) return [];
  const v = /^(textbox|searchbox)$/.test(m[1]) ? VALUE.exec(l)?.[1] : undefined;
  return [`${m[1]} ${m[2] ?? ""}${m[3] ?? ""}${v !== undefined ? ": " + v : ""}`.trim()];
});

let s: Awaited<ReturnType<typeof startRunServer>>; let browser: any; let page: any; let driver: WebSocket; let nextId = 1;
const pending = new Map<number, (m: any) => void>();
const ask = (type: string) => new Promise<any>((ok) => { const id = nextId++; pending.set(id, ok); driver.send(JSON.stringify({ id, type })); });
const frame = () => page.frames().find((f: any) => f !== page.mainFrame());

/** The simulator's tree: server.mjs `screen()` applies the shared rules, hides aria-hidden nodes, then asks Playwright. */
async function simulatorTree(): Promise<string> {
  const rules = await import(pathToFileURL(join(simDir, "screen-rules.mjs")).href);
  const f = frame();
  await f.evaluate(`(${rules.clearScreenRules})(document); (${rules.applyScreenRules})(document)`);
  await f.evaluate(() => { for (const el of document.querySelectorAll('[aria-hidden="true"]')) (el as HTMLElement).style.setProperty("display", "none", "important"); });
  const tree = await page.frameLocator("#app").locator("body").ariaSnapshot({ mode: "ai" });
  await f.evaluate(`(${rules.clearScreenRules})(document)`);
  return rules.filterTree(tree);
}

const click = async (name: string | RegExp) => { await frame().getByRole("button", { name }).first().click(); await page.waitForTimeout(250); };
const screens: Record<string, { sim: string; bridge: string }> = {};
async function capture(name: string) {
  await page.waitForTimeout(250);
  const sim = await simulatorTree();
  const r = await ask("tree");
  expect(r.ok, r.error).toBe(true);
  screens[name] = { sim, bridge: r.tree };
}

beforeAll(async () => {
  const dist = mkdtempSync(join(tmpdir(), "shipvo-bridge-"));
  const ex = spawnSync("npx", ["expo", "export", "--platform", "web", "--output-dir", dist, "--clear"], { cwd: app, env: { ...process.env, PN_SIM: "1", CI: "1" }, encoding: "utf8" });
  if (ex.status !== 0) throw new Error("expo export failed:\n" + ex.stdout + ex.stderr);
  const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const r = spawnSync(process.execPath, [join(dirname(require.resolve("playwright/package.json")), "cli.js"), "install", "chromium"], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("could not install Chromium for playwright");
  }
  s = await startRunServer({ dir: dist, platform: "ios", name: "Tide" });
  browser = await pw.chromium.launch();
  page = await browser.newPage({ viewport: { width: 500, height: 950 } });
  await page.goto(`http://127.0.0.1:${s.port}/`);
  await page.waitForSelector("#app");
  await frame().waitForSelector("h1");
  driver = new WebSocket(`ws://127.0.0.1:${s.port}/__shipvo/agent?role=driver&token=${s.token}`);
  driver.onmessage = (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); pending.delete(m.id); };
  await new Promise((ok, fail) => { driver.onopen = ok; driver.onerror = () => fail(new Error("driver refused")); });
  await page.waitForTimeout(300);

  await capture("home");
  await click("Scan a product barcode"); await capture("scan"); // The camera permission sheet is modal: only it is on screen. Reload to leave the scanner.
  await page.reload(); await frame().waitForSelector("h1"); await page.waitForTimeout(500);
  await click("Open search"); await capture("search");
  await click("Lures"); await capture("search-lures");
  await frame().getByRole("button", { name: /FCFA/ }).first().click(); await page.waitForTimeout(250); await capture("product");
  await click(/Increase quantity/); await click(/^Add \d+ to cart/); await capture("product-added");
  await click("Go to cart"); await capture("cart");
  await click("Choose delivery and pay"); await capture("checkout");
  await click("Mobile money"); await capture("checkout-mobile-money");
  await click("Back"); await click("Back"); await click("Back"); await click("Back");
  const before = await simulatorTree();
  await click("My orders"); await capture("orders");
  expect(screens.orders.sim, "My orders opens a new screen").not.toBe(before);
  await click("Back"); await click("About this build"); await capture("about");
}, 240_000);

afterAll(async () => { driver?.close(); await browser?.close(); await s?.close(); });

describe("run bridge tree", () => {
  it("is equivalent to the simulator tree on every sample-app screen", () => {
    expect(Object.keys(screens).length).toBeGreaterThanOrEqual(10);
    for (const [name, t] of Object.entries(screens)) {
      expect(interactive(t.bridge), `screen ${name}`).toEqual(interactive(t.sim));
      expect(interactive(t.bridge).length, `screen ${name} has elements`).toBeGreaterThan(0);
    }
  });
  it("prints lines in the simulator's shape", () => {
    const lines = screens.home.bridge.split("\n");
    expect(lines).toContain('- heading "Tide & Tackle" [level=1] [ref=' + /\[ref=(e\d+)\]/.exec(lines.find((l) => l.includes("Tide & Tackle"))!)![1] + "]");
    for (const l of lines) expect(l).toMatch(/^( {2})*- [a-z]+( "(?:[^"\\]|\\.)*")?( \[[a-z]+(=\w+)?\])*(:.*)?$/);
  });
  it("covers several roles", () => { const roles = new Set(Object.values(screens).flatMap((t) => interactive(t.sim).map((x) => x.split(" ")[0]))); for (const r of ["heading", "button", "textbox", "radio"]) expect(roles.has(r), r).toBe(true); });
  it("keeps refs stable when the same screen is read twice", async () => {
    const a = await ask("tree"); const b = await ask("tree");
    expect(a.tree).toBe(b.tree);
    expect(a.tree).toMatch(/\[ref=e\d+\]/);
  });
  it("reports an error for a request it does not know", async () => {
    const r = await ask("dance");
    expect(r).toMatchObject({ ok: false });
  });
  it("is served as a script with the screen rules inside", () => {
    const src = bridgeScript();
    expect(src).toContain("applyScreenRules");
    expect(() => new Function(src)).not.toThrow();
  });
});
