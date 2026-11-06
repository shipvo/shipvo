// #875: Lumi reacts to a failed action and to a page error in the app, with the real message as the reason.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startRunServer } from "../src/run";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(resolve(here, "../../sim"), "package.json"));
const APP = `<!doctype html><title>t</title><h1>Home</h1><button id="b">Boom</button><script>document.getElementById("b").onclick=function(){setTimeout(function(){throw new Error("cart total is NaN\\n  at x.js:1")},0)}</script>`;

let browser: any, server: Awaited<ReturnType<typeof startRunServer>>, page: any, driver: WebSocket, nextId = 1;
const pending = new Map<number, (m: any) => void>();
const ask = (body: Record<string, unknown>) => new Promise<any>((ok) => { const id = nextId++; pending.set(id, ok); driver.send(JSON.stringify({ id, ...body })); });
const lumi = () => page.$eval('[data-part="lumi"]', (e: any) => ({ state: e.dataset.state, reason: e.dataset.reason ?? null }));

beforeAll(async () => {
  process.env.SHIPVO_LUMI = "on";
  const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) throw new Error("Chromium is not installed");
  browser = await pw.chromium.launch();
  const dist = mkdtempSync(join(tmpdir(), "shipvo-bridge-lumi-")); writeFileSync(join(dist, "index.html"), APP);
  server = await startRunServer({ dir: dist, platform: "android", name: "Test" });
  page = await browser.newPage({ viewport: { width: 500, height: 950 } });
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.frames().find((f: any) => f !== page.mainFrame()).waitForSelector("#b");
  driver = new WebSocket(`ws://127.0.0.1:${server.port}/__shipvo/agent?role=driver&token=${server.token}`);
  driver.onmessage = (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); pending.delete(m.id); };
  await new Promise((ok, fail) => { driver.onopen = ok; driver.onerror = () => fail(new Error("driver refused")); });
  await page.waitForTimeout(300);
}, 60_000);
afterAll(async () => { delete process.env.SHIPVO_LUMI; driver?.close(); await server?.close(); await browser?.close(); });

describe("Lumi in the run page", () => {
  it("is worried with the real message after a failed action", async () => {
    expect((await lumi()).state).toBe("idle");
    const m = await ask({ type: "tap", ref: "e999" });
    expect(m.ok).toBe(false);
    const l = await lumi();
    expect(l.state).toBe("worried");
    expect(l.reason).toMatch(/^Action failed \(tap\): stale ref e999: the screen changed/);
  });
  it("is worried with the page error's message when the app throws", async () => {
    await page.evaluate(() => (window as any).shipvoLumi.set("idle"));
    await page.frames().find((f: any) => f !== page.mainFrame()).click("#b");
    await page.waitForFunction(() => document.querySelector('[data-part="lumi"]')!.getAttribute("data-state") === "worried");
    expect((await lumi()).reason).toBe("Page error: Uncaught Error: cart total is NaN");
  });
});
