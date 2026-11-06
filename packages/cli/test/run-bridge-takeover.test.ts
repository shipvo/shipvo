// Slice 4 of #448: the person sees what the agent does and can take over.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startRunServer } from "../src/run";

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../../sim/package.json"));
let browser: any, server: Awaited<ReturnType<typeof startRunServer>>, page: any, driver: WebSocket, nextId = 1;
const pending = new Map<number, (m: any) => void>();
const ask = (body: Record<string, unknown>) => new Promise<any>((ok) => { const id = nextId++; pending.set(id, ok); driver.send(JSON.stringify({ id, ...body })); });
const refOf = (tree: string, label: string) => new RegExp(label + "[^\\n]*\\[ref=(\\w+)\\]").exec(tree)![1];

beforeAll(async () => {
  const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const r = spawnSync(process.execPath, [join(dirname(require.resolve("playwright/package.json")), "cli.js"), "install", "chromium"], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("could not install Chromium for playwright");
  }
  browser = await pw.chromium.launch();
  const dist = mkdtempSync(join(tmpdir(), "shipvo-takeover-"));
  writeFileSync(join(dist, "index.html"), `<!doctype html><body><h1>Shop</h1><button id="b" onclick="this.textContent='Added'">Add to cart</button></body>`);
  server = await startRunServer({ dir: dist, platform: "ios", name: "Test" });
  page = await browser.newPage({ viewport: { width: 500, height: 950 } });
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.frames().find((f: any) => f !== page.mainFrame()).waitForSelector("#b");
  driver = new WebSocket(`ws://127.0.0.1:${server.port}/__shipvo/agent?role=driver&token=${server.token}`);
  driver.onmessage = (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); pending.delete(m.id); };
  await new Promise((ok, fail) => { driver.onopen = ok; driver.onerror = () => fail(new Error("driver refused")); });
  await page.waitForTimeout(300);
}, 120_000);
afterAll(async () => { driver?.close(); await server?.close(); await browser?.close(); });

describe("run bridge: visible agent and take-over", () => {
  it("shows the dot, the outline, the banner and a plain step on an agent tap", async () => {
    const tree = (await ask({ type: "tree" })).tree as string;
    const m = await ask({ type: "tap", ref: refOf(tree, 'button "Add to cart"') });
    expect(m.ok, m.error).toBe(true);
    expect(await page.isVisible("#shipvo-dot")).toBe(true);
    expect(await page.isVisible("#shipvo-outline")).toBe(true);
    expect(await page.textContent("#shipvo-agent")).toContain("Agent is driving");
    expect(await page.textContent("#shipvo-log")).toContain('Tapped button "Add to cart"');
  });

  it("marks simulated device events in the step log", async () => {
    await page.evaluate(() => (document.getElementById("app") as HTMLIFrameElement).contentWindow!.parent.postMessage({ type: "shipvo:system-sheet", open: true }, "*"));
    await page.waitForSelector('#shipvo-log li[data-simulated="true"]');
    expect(await page.textContent('#shipvo-log li[data-simulated="true"]')).toBe("System permission sheet opened (simulated)");
  });

  it("a person's touch pauses the agent, and Hand back resumes it", async () => {
    await page.mouse.click(30, 300);
    expect(await page.textContent("#shipvo-agent")).toContain("You took over");
    const blocked = await ask({ type: "tap", ref: "e1" });
    expect(blocked).toMatchObject({ ok: false, code: "taken_over", error: "the person took over" });
    await page.click("#shipvo-agent button");
    expect(await page.textContent("#shipvo-agent")).toContain("Agent is driving");
    expect((await ask({ type: "tree" })).ok).toBe(true);
    expect((await ask({ type: "scroll", direction: "down" })).ok).toBe(true);
  });

  it("a key press by the person also pauses the agent", async () => {
    await page.keyboard.press("a");
    expect((await ask({ type: "back" })).code).toBe("taken_over");
    await page.click("#shipvo-agent button");
  });
});
