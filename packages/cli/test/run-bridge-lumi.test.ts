// #874: Lumi shows each agent step in the phone frame, from the real action and its element. A scripted driver session
// does what @shipvo/mcp does: tree, tap, type, scroll, back, and the `lumi` message for opening the app.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startRunServer } from "../src/run";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(resolve(here, "../../sim"), "package.json"));
const HTML = `<!doctype html><meta name=viewport content="width=device-width"><body style="margin:0"><h1>Shop</h1>
<button id=co onclick="document.title='paid'">Checkout</button><input aria-label="Promo code"><div style="height:2000px"></div></body>`;

let browser: any, server: Awaited<ReturnType<typeof startRunServer>>, page: any, driver: WebSocket;
let nextId = 1; const pending = new Map<number, (m: any) => void>();
const ask = (body: Record<string, unknown>) => new Promise<any>((ok) => { const id = nextId++; pending.set(id, ok); driver.send(JSON.stringify({ id, ...body })); });
const lumi = () => page.evaluate(() => { const l = document.querySelector('[data-part="lumi"]') as HTMLElement, c = document.querySelector('[data-part="lumi-caption"]') as HTMLElement; return { state: l.dataset.state, caption: c.hidden ? "" : c.textContent }; });
const refOf = (tree: string, label: string) => { const m = new RegExp(label + "[^\\n]*\\[ref=(\\w+)\\]").exec(tree); if (!m) throw new Error(`no ref for ${label} in\n${tree}`); return m[1]; };

beforeAll(async () => {
  process.env.SHIPVO_LUMI = "on";
  const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const r = spawnSync(process.execPath, [join(dirname(require.resolve("playwright/package.json")), "cli.js"), "install", "chromium"], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("could not install Chromium for playwright");
  }
  browser = await pw.chromium.launch();
  const dist = mkdtempSync(join(tmpdir(), "shipvo-bridge-lumi-")); writeFileSync(join(dist, "index.html"), HTML);
  server = await startRunServer({ dir: dist, platform: "android", name: "Test" });
  page = await browser.newPage({ viewport: { width: 500, height: 950 } });
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.frames().find((f: any) => f !== page.mainFrame()).waitForSelector("button");
  driver = new WebSocket(`ws://127.0.0.1:${server.port}/__shipvo/agent?role=driver&token=${server.token}`);
  driver.onmessage = (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); pending.delete(m.id); };
  await new Promise((ok, fail) => { driver.onopen = ok; driver.onerror = () => fail(new Error("driver refused")); });
  await page.waitForTimeout(300);
}, 120_000);
afterAll(async () => { driver?.close(); await server?.close(); await browser?.close(); delete process.env.SHIPVO_LUMI; });

describe("Lumi captions each agent step", () => {
  it("starts idle with no caption", async () => { expect(await lumi()).toEqual({ state: "idle", caption: "" }); });

  it("shows the real element's label while a step runs, then settles", async () => {
    // Record every caption and state Lumi shows, in order.
    await page.evaluate(() => {
      const seen: string[] = ((window as any).__lumiSeen = []);
      const l = document.querySelector('[data-part="lumi"]')!, c = document.querySelector('[data-part="lumi-caption"]')!;
      const note = () => seen.push(`${(l as HTMLElement).dataset.state}:${(c as HTMLElement).hidden ? "" : c.textContent}`);
      new MutationObserver(note).observe(l, { attributes: true }); new MutationObserver(note).observe(c, { attributes: true, childList: true, characterData: true, subtree: true });
    });
    const tree = (await ask({ type: "screen" })).screen as string;
    expect((await ask({ type: "tap", ref: refOf(tree, 'button "Checkout"') })).ok).toBe(true);
    expect(await page.evaluate(() => (window as any).__lumiSeen)).toContain("working:Tapping Checkout");
    expect((await lumi()).state).toBe("idle"); // not "working" any more: the step is done
    await page.waitForTimeout(2000);
    expect(await lumi()).toEqual({ state: "idle", caption: "" });
  });

  it("names type, scroll and back from the action", async () => {
    const tree = (await ask({ type: "screen" })).screen as string;
    const seen = () => page.evaluate(() => (window as any).__lumiSeen as string[]);
    await ask({ type: "type", ref: refOf(tree, 'textbox "Promo code"'), text: "SAVE" });
    await ask({ type: "scroll", direction: "down" });
    await ask({ type: "back" });
    const s = await seen();
    expect(s).toContain("working:Typing into Promo code");
    expect(s).toContain("working:Scrolling down");
    expect(s).toContain("working:Going back");
  });

  it("shows worried when the action fails, and never invents a label", async () => {
    const m = await ask({ type: "tap", ref: "e99999" });
    expect(m.ok).toBe(false);
    expect(await lumi()).toEqual({ state: "worried", caption: "Failed: Tapping an element" });
  });

  it("shows a step the MCP server names (opening the app), and refuses a bad state", async () => {
    expect((await ask({ type: "lumi", caption: "Opened tide", state: "working", hold: 1800 })).ok).toBe(true);
    expect(await lumi()).toEqual({ state: "working", caption: "Opened tide" });
    expect((await ask({ type: "lumi", caption: "x", state: "angry" })).ok).toBe(false);
    await page.waitForTimeout(2000);
    expect(await lumi()).toEqual({ state: "idle", caption: "" });
  });

  it("keeps the caption out of the screen tree the agent reads, and hidden from assistive tech", async () => {
    await ask({ type: "lumi", caption: "Opened tide", state: "working", hold: 1800 });
    expect(((await ask({ type: "screen" })).screen as string)).not.toContain("Opened tide");
    expect(await page.$eval('[data-part="lumi-caption"]', (e: HTMLElement) => e.getAttribute("aria-hidden") + e.hasAttribute("inert")) ).toBe("truetrue");
  });
});
