// Slice 3c of #448: the frame-page bridge runs tap, type, scroll and back by ref.
// 1) the simulator's ref-stability cases run against the bridge (the case list is shared, not copied);
// 2) all four actions work on the sample app's shop flow.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startRunServer } from "../src/run";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "../../../apps/tide-and-tackle");
const simDir = resolve(here, "../../sim");
const require = createRequire(join(simDir, "package.json"));

type Run = { server: Awaited<ReturnType<typeof startRunServer>>; page: any; driver: WebSocket; ask: (body: Record<string, unknown>) => Promise<any> };
let browser: any; const runs: Run[] = [];

async function connect(dir: string, ready: string): Promise<Run> {
  const server = await startRunServer({ dir, platform: "ios", name: "Test" });
  const page = await browser.newPage({ viewport: { width: 500, height: 950 } });
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.waitForSelector("#app");
  await page.frames().find((f: any) => f !== page.mainFrame()).waitForSelector(ready);
  const driver = new WebSocket(`ws://127.0.0.1:${server.port}/__shipvo/agent?role=driver&token=${server.token}`);
  let nextId = 1; const pending = new Map<number, (m: any) => void>();
  driver.onmessage = (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); pending.delete(m.id); };
  await new Promise((ok, fail) => { driver.onopen = ok; driver.onerror = () => fail(new Error("driver refused")); });
  await page.waitForTimeout(300);
  const ask = (body: Record<string, unknown>) => new Promise<any>((ok) => { const id = nextId++; pending.set(id, ok); driver.send(JSON.stringify({ id, ...body })); });
  const run = { server, page, driver, ask }; runs.push(run); return run;
}

beforeAll(async () => {
  const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const r = spawnSync(process.execPath, [join(dirname(require.resolve("playwright/package.json")), "cli.js"), "install", "chromium"], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("could not install Chromium for playwright");
  }
  browser = await pw.chromium.launch();
}, 120_000);
afterAll(async () => { for (const r of runs) { r.driver.close(); await r.server.close(); } await browser?.close(); });

describe("run bridge actions: the simulator's ref-stability cases", async () => {
  const shared = await import(pathToFileURL(join(simDir, "ref-stability.cases.mjs")).href);
  let r: Run;
  beforeAll(async () => {
    const dist = mkdtempSync(join(tmpdir(), "shipvo-bridge-refs-")); mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "index.html"), shared.ONE); writeFileSync(join(dist, "two.html"), shared.TWO);
    r = await connect(dist, "#list");
  }, 60_000);
  const driver = {
    // Each case starts from the first page, as the simulator's `open` does with a new session.
    open: async (_id: string) => {
      await r.page.evaluate(() => { (document.getElementById("app") as HTMLIFrameElement).contentWindow!.location.href = "/index.html"; });
      await r.page.waitForTimeout(600);
      const t = await r.ask({ type: "tree" }); expect(t.ok, t.error).toBe(true); return t.tree as string;
    },
    act: async (_id: string, { action, ...rest }: any) => { const m = await r.ask({ type: action, ...rest }); return m; },
  };
  for (const [name, run] of shared.cases as [string, (d: typeof driver) => Promise<void>][]) it(name, () => run(driver), 30_000);
});

describe("run bridge actions: sample app shop flow", () => {
  let r: Run;
  const refOf = (tree: string, label: string) => { const m = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^\\n]*\\[ref=(\\w+)\\]").exec(tree); if (!m) throw new Error(`no ref for ${label} in\n${tree}`); return m[1]; };
  const ok = (m: any) => { expect(m.ok, m.error).toBe(true); return m.screen as string; };
  beforeAll(async () => {
    const dist = mkdtempSync(join(tmpdir(), "shipvo-bridge-shop-"));
    const ex = spawnSync("npx", ["expo", "export", "--platform", "web", "--output-dir", dist, "--clear"], { cwd: app, env: { ...process.env, PN_SIM: "1", CI: "1" }, encoding: "utf8" });
    if (ex.status !== 0) throw new Error("expo export failed:\n" + ex.stdout + ex.stderr);
    r = await connect(dist, "h1");
  }, 240_000);

  it("taps, types, scrolls and goes back", async () => {
    let t = (await r.ask({ type: "tree" })).tree as string;
    t = ok(await r.ask({ type: "tap", ref: refOf(t, 'button "Open search"') }));
    const box = /textbox[^\n]*\[ref=(\w+)\]/.exec(t);
    expect(box, t).toBeTruthy();
    const typed = await r.ask({ type: "type", ref: box![1], text: "zzzz" });
    expect(ok(typed)).toContain("0 results"); // React Native Web saw the input event
    expect(typed.value).toBe("zzzz");
    t = ok(await r.ask({ type: "type", ref: box![1], text: "" }));
    t = ok(await r.ask({ type: "tap", ref: refOf(t, 'button "Filter Lures"') }));
    t = ok(await r.ask({ type: "scroll", direction: "down" }));
    t = ok(await r.ask({ type: "tap", ref: refOf(t, "FCFA") }));
    expect(t).toMatch(/Add \d+ to cart|Increase quantity/);
    const before = t;
    t = ok(await r.ask({ type: "back" }));
    expect(t).not.toBe(before);
  }, 60_000);

  it("returns stale_ref for an unknown ref", async () => {
    const m = await r.ask({ type: "tap", ref: "e99999" });
    expect(m).toMatchObject({ ok: false, code: "stale_ref" });
    expect(m.error).toMatch(/new snapshot/);
  });
});
