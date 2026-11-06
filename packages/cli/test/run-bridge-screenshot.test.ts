// Slice 5 of #448: `screenshot` in attach mode. Tab capture when the person allows it, else the iframe drawn to an image.
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
const PAGE = `<!doctype html><html><head><title>t</title><style>body{margin:0;background:#fff}h1{color:#c00}</style></head><body>
<h1>Hello shots</h1><button>Buy</button><img alt="far" src="https://example.invalid/x.png"><video width="50" height="30"></video></body></html>`;

let browser: any; const closers: (() => Promise<void>)[] = [];
async function connect(init?: string, html = PAGE) {
  const dist = mkdtempSync(join(tmpdir(), "shipvo-shot-")); writeFileSync(join(dist, "index.html"), html);
  const server = await startRunServer({ dir: dist, platform: "ios", name: "Test" });
  const page = await browser.newPage({ viewport: { width: 500, height: 950 } });
  if (init) await page.addInitScript(init);
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.waitForSelector("#app");
  await page.frames().find((f: any) => f !== page.mainFrame()).waitForSelector("h1");
  const driver = new WebSocket(`ws://127.0.0.1:${server.port}/__shipvo/agent?role=driver&token=${server.token}`);
  let nextId = 1; const pending = new Map<number, (m: any) => void>();
  driver.onmessage = (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); pending.delete(m.id); };
  await new Promise((ok, fail) => { driver.onopen = ok; driver.onerror = () => fail(new Error("driver refused")); });
  await page.waitForTimeout(300);
  closers.push(async () => { driver.close(); await server.close(); await page.close(); });
  const ask = (body: Record<string, unknown>) => new Promise<any>((ok) => { const id = nextId++; pending.set(id, ok); driver.send(JSON.stringify({ id, ...body })); });
  return { page, ask };
}
const isPng = (b64: string) => Buffer.from(b64, "base64").subarray(1, 4).toString() === "PNG";
// A canvas of random pixels: a PNG of it is several MiB, far over the 1 MiB socket limit.
const NOISY = `<!doctype html><html><body style="margin:0"><h1>Noisy shots</h1><canvas id="n" width="900" height="1800"></canvas><script>
const c=document.getElementById("n"),g=c.getContext("2d"),d=g.createImageData(900,1800);for(let i=0;i<d.data.length;i++)d.data[i]=i%4==3?255:Math.random()*256;g.putImageData(d,0,0);</script></body></html>`;

beforeAll(async () => {
  const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const r = spawnSync(process.execPath, [join(dirname(require.resolve("playwright/package.json")), "cli.js"), "install", "chromium"], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("could not install Chromium for playwright");
  }
  browser = await pw.chromium.launch({ channel: "chromium", args: ["--auto-accept-this-tab-capture"] }) // the new headless mode: the old shell cannot capture a tab;
}, 120_000);
afterAll(async () => { for (const c of closers) await c().catch(() => {}); await browser?.close(); });

describe("run bridge screenshot", () => {
  it("draws the page and says what it could not draw when nobody answered the question", async () => {
    const { page, ask } = await connect();
    const r = await ask({ type: "screenshot" });
    expect(r.ok, r.error).toBe(true);
    expect(r.source).toBe("rendered");
    expect(isPng(r.image)).toBe(true);
    expect(r.image.length, "not a blank image").toBeGreaterThan(3000);
    expect(r.unsupported).toEqual(expect.arrayContaining(["video", "cross-origin images"]));
    expect(r.screen).toContain("Hello shots");
    await expect(page.locator("#shipvo-capture").isVisible()).resolves.toBe(true); // the question was asked
  }, 30_000);

  it("uses tab capture after the person allows it, once for the session", async () => {
    const { page, ask } = await connect();
    await ask({ type: "screenshot" }); // the first request raises the question
    await page.click("#shipvo-capture button:text('Allow')");
    await page.waitForFunction(() => document.querySelector("#shipvo-log")?.textContent?.includes("can see this tab"));
    for (let i = 0; i < 2; i++) {
      const r = await ask({ type: "screenshot" });
      expect(r.ok, r.error).toBe(true);
      expect(r.source).toBe("tab-capture");
      expect(isPng(r.image)).toBe(true);
      expect(r.width).toBeGreaterThan(100); expect(r.height).toBeGreaterThan(r.width);
      expect(r.screen).toContain("Hello shots");
    }
    await expect(page.locator("#shipvo-capture").isVisible()).resolves.toBe(false);
  }, 30_000);

  it("falls back to rendered when the person refuses", async () => {
    const { page, ask } = await connect();
    await ask({ type: "screenshot" });
    await page.click("#shipvo-capture button:text('Not now')");
    const r = await ask({ type: "screenshot" });
    expect(r.ok, r.error).toBe(true); expect(r.source).toBe("rendered"); expect(isPng(r.image)).toBe(true);
  }, 30_000);

  it("falls back to rendered when the browser refuses the capture", async () => {
    const { page, ask } = await connect(`navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new DOMException("no", "NotAllowedError"));`);
    await ask({ type: "screenshot" });
    await page.click("#shipvo-capture button:text('Allow')");
    await page.waitForFunction(() => document.querySelector("#shipvo-log")?.textContent?.includes("refused"));
    const r = await ask({ type: "screenshot" });
    expect(r.ok, r.error).toBe(true); expect(r.source).toBe("rendered");
  }, 30_000);

  it("keeps big screenshots under the socket limit and the connection open", async () => {
    const { page, ask } = await connect(undefined, NOISY);
    const a = await ask({ type: "screenshot" });
    expect(a.ok, a.error).toBe(true); expect(a.source).toBe("rendered");
    expect(a.image.length).toBeLessThan(900_000);
    await page.click("#shipvo-capture button:text('Allow')");
    await page.waitForFunction(() => document.querySelector("#shipvo-log")?.textContent?.includes("can see this tab"));
    const b = await ask({ type: "screenshot" });
    expect(b.ok, b.error).toBe(true); expect(b.source).toBe("tab-capture");
    expect(b.image.length).toBeLessThan(900_000);
    const s = await ask({ type: "screen" }); // the socket is still open
    expect(s.ok).toBe(true);
  }, 60_000);

  it("asks again after the person stops sharing the tab", async () => {
    const { page, ask } = await connect(`const g = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getDisplayMedia = async (o) => (window.__s = await g(o));`);
    await ask({ type: "screenshot" });
    await page.click("#shipvo-capture button:text('Allow')");
    await page.waitForFunction(() => document.querySelector("#shipvo-log")?.textContent?.includes("can see this tab"));
    await page.evaluate(() => { for (const t of (window as any).__s.getTracks()) { t.stop(); t.dispatchEvent(new Event("ended")); } });
    await page.waitForFunction(() => document.querySelector("#shipvo-log")?.textContent?.includes("sharing stopped"));
    const r = await ask({ type: "screenshot" });
    expect(r.ok, r.error).toBe(true); expect(r.source).toBe("rendered");
    await expect(page.locator("#shipvo-capture").isVisible()).resolves.toBe(true);
  }, 30_000);
});
