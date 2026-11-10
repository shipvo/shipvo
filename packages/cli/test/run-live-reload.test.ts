// Slice 2 of #442: live reload on save for `shipvo run`. A fixture app is built by a small script, the watcher
// rebuilds it, and the frame page in Chromium reloads the app or shows the error in a banner outside the phone.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startRunServer, type Platform } from "../src/run";
import { rebuildInto, watchAndRebuild } from "../src/sim";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(resolve(here, "../../sim"), "package.json"));
// The fixture build: copies src/title.txt into <out>/index.html, and fails like a compiler on a syntax error.
const BUILD = `const fs=require("fs"),p=require("path");const out=process.argv[2];const t=fs.readFileSync("src/title.txt","utf8").trim();
if(t.includes("<<syntax error>>")){console.error("SyntaxError: Unexpected token in src/title.txt");process.exit(1)}
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(p.join(out,"index.html"),"<!doctype html><body style='margin:0;font:28px sans-serif;background:#fff'><h1>"+t+"</h1></body>");`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.SHIPVO_RUN_SHOTS_DIR;

let browser: any;
beforeAll(async () => {
  const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const r = spawnSync(process.execPath, [join(dirname(require.resolve("playwright/package.json")), "cli.js"), "install", "chromium"], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("could not install Chromium for playwright");
  }
  browser = await pw.chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function session(platform: Platform, viewport = { width: 500, height: 950 }) {
  const root = mkdtempSync(join(tmpdir(), "shipvo-live-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "title.txt"), "Hello tide");
  writeFileSync(join(root, "build.cjs"), BUILD);
  const command = "node build.cjs";
  await rebuildInto({ root, command });
  const server = await startRunServer({ dir: join(root, "sim-dist"), platform, name: "Tide" });
  const log: string[] = [];
  let reloadAt = 0;
  const stop = watchAndRebuild({
    dir: root, debounceMs: 50, log: (l) => log.push(l),
    build: () => rebuildInto({ root, command }),
    onStart: () => server.notify({ type: "building" }),
    onResult: (r) => { if (r.ok) reloadAt = Date.now(); server.notify(r.ok ? { type: "reload" } : { type: "error", message: r.message }); },
  });
  await wait(100);
  const page = await browser.newPage({ viewport });
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.waitForSelector("#app");
  const app = () => page.frames().find((f: any) => f !== page.mainFrame());
  await app().waitForSelector("h1");
  await wait(200); // the page's event stream is connected
  const edit = (text: string) => writeFileSync(join(root, "src", "title.txt"), text);
  return { page, app, edit, log, root, reloadAt: () => reloadAt, close: async () => { stop(); await page.close(); await server.close(); } };
}

describe.each(["android", "ios"] as const)("live reload on %s", (platform) => {
  it("shows the edited text in the frame after a save", async () => {
    const s = await session(platform);
    try {
      expect(await s.app().textContent("h1")).toBe("Hello tide");
      if (SHOTS) await s.page.screenshot({ path: join(SHOTS, `${platform}-before.png`) });
      const t0 = Date.now();
      s.edit("Hello harbour");
      await s.page.waitForSelector("#updating:not([hidden])", { timeout: 5000 });
      expect(s.log[0]).toBe("Rebuilding...");
      await s.app().waitForFunction(() => document.querySelector("h1")?.textContent === "Hello harbour", null, { timeout: 15000 });
      expect(await s.page.isHidden("#updating")).toBe(true);
      const ms = Date.now() - t0;
      console.log(`save-to-visible ${platform}: ${ms} ms`);
      expect(s.log.at(-1)).toMatch(/^rebuilt in/);
      if (SHOTS) await s.page.screenshot({ path: join(SHOTS, `${platform}-after.png`) });
    } finally { await s.close(); }
  }, 60_000);

  it("a syntax error keeps the previous page and shows the error outside the phone", async () => {
    const s = await session(platform);
    try {
      s.edit("<<syntax error>>");
      await s.page.waitForSelector("#banner:not([hidden])", { timeout: 15000 });
      expect(await s.page.textContent("#banner")).toContain("build failed, still serving the last good build");
      expect(await s.page.textContent("#banner")).toContain("Unexpected token");
      expect(await s.app().textContent("h1")).toBe("Hello tide");
      expect(s.log.at(-1)).toContain("still serving the last good build");
      expect(await s.page.evaluate(() => document.getElementById("phone")!.contains(document.getElementById("banner")))).toBe(false);
      if (SHOTS) await s.page.screenshot({ path: join(SHOTS, `${platform}-error.png`) });
      s.edit("Fixed");
      await s.page.waitForSelector("#updating:not([hidden])", { timeout: 5000 });
      expect(await s.page.isHidden("#banner")).toBe(true); // the stale error never sits under the pill
      if (SHOTS) await s.page.screenshot({ path: join(SHOTS, `${platform}-fix-building.png`) });
      await s.app().waitForFunction(() => document.querySelector("h1")?.textContent === "Fixed", null, { timeout: 15000 });
      expect(await s.page.isHidden("#banner")).toBe(true);
    } finally { await s.close(); }
  }, 60_000);

  describe.each([
    { name: "1000x600 with the device panel open", viewport: { width: 1000, height: 600 }, open: true },
    { name: "1000x600 with the device panel closed", viewport: { width: 1000, height: 600 }, open: false },
    { name: "390x844", viewport: { width: 390, height: 844 }, open: false },
  ])("error bar at $name", ({ name, viewport, open }) => {
    it("sits inside the window, below the title bar, above the phone and clear of the device panel", async () => {
      const s = await session(platform, viewport);
      try {
        await s.page.evaluate((o: boolean) => { (document.getElementById("dpanel") as HTMLDetailsElement).open = o; }, open);
        await wait(100);
        s.edit("<<syntax error>>");
        await s.page.waitForSelector("#banner:not([hidden])", { timeout: 15000 });
        const r = await s.page.evaluate(() => {
          const q = (id: string) => document.getElementById(id)!.getBoundingClientRect();
          const b = q("banner"), t = q("top"), p = q("phone"), d = q("dpanel");
          const hit = b.left < d.right && b.right > d.left && b.top < d.bottom && b.bottom > d.top;
          return { bTop: b.top, bBottom: b.bottom, bLeft: b.left, bRight: b.right, tBottom: t.bottom, pTop: p.top, h: innerHeight, w: innerWidth, hit };
        });
        expect(r.bTop).toBeGreaterThanOrEqual(0);
        expect(r.bBottom).toBeLessThanOrEqual(r.h);
        expect(r.bLeft).toBeGreaterThanOrEqual(0);
        expect(r.bRight).toBeLessThanOrEqual(r.w);
        expect(r.bTop).toBeGreaterThanOrEqual(r.tBottom - 1);
        expect(r.bBottom).toBeLessThanOrEqual(r.pTop + 1);
        expect(r.hit).toBe(false);
        if (SHOTS) await s.page.screenshot({ path: join(SHOTS, `${platform}-error-${name.replace(/[^a-z0-9]+/gi, "-")}.png`) });
      } finally { await s.close(); }
    }, 60_000);
  });
});
