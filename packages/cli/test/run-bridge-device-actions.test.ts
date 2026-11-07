// #1148: the bridge's device actions (get_settings, set_setting, notifications, dismiss_notification, open_url) run against a
// fake `__pnDevice` shaped like @shipvo/device. Settings use the simulator's rules: same keys, error codes and the language -> rtl rule.
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
const APP = `<!doctype html><html><head><meta charset="utf-8"><script>
var sys={darkMode:false,fontSize:"default",boldText:false,reduceMotion:false,language:"en",rtl:false};
var notes=[{id:"n1",title:"Hi",body:"there"},{id:"n2",title:"Two",body:"x"}];
window.__opened=[];
window.__pnDevice={
  set:function(p){Object.assign(sys,p)}, system:function(){return Object.assign({},sys)},
  settings:function(){return {wifi:true,dnd:false}},
  notifications:function(){return notes.slice()},
  dismiss:function(id){var n=notes.length;notes=notes.filter(function(x){return x.id!==id});return notes.length<n},
  clearAll:function(){notes=[]},
  openUrl:function(u){window.__opened.push(u);return Promise.resolve(/^myapp:/.test(u))}
};
</script></head><body><h1 id="ready">fixture</h1></body></html>`;

let browser: any, server: Awaited<ReturnType<typeof startRunServer>>, page: any, driver: WebSocket;
let nextId = 1; const pending = new Map<number, (m: any) => void>();
const ask = (body: Record<string, unknown>) => new Promise<any>((ok) => { const id = nextId++; pending.set(id, ok); driver.send(JSON.stringify({ id, ...body })); });

beforeAll(async () => {
  const pw = require("playwright");
  if (!existsSync(pw.chromium.executablePath())) {
    const r = spawnSync(process.execPath, [join(dirname(require.resolve("playwright/package.json")), "cli.js"), "install", "chromium"], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("could not install Chromium for playwright");
  }
  browser = await pw.chromium.launch();
  const dir = mkdtempSync(join(tmpdir(), "shipvo-devact-")); writeFileSync(join(dir, "index.html"), APP);
  server = await startRunServer({ dir, platform: "android", name: "Test" });
  page = await browser.newPage({ viewport: { width: 500, height: 950 } });
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.waitForSelector("#app");
  await page.frames().find((f: any) => f !== page.mainFrame()).waitForSelector("#ready");
  driver = new WebSocket(`ws://127.0.0.1:${server.port}/__shipvo/agent?role=driver&token=${server.token}`);
  driver.onmessage = (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); pending.delete(m.id); };
  await new Promise((ok, fail) => { driver.onopen = ok; driver.onerror = () => fail(new Error("driver refused")); });
  await page.waitForTimeout(300);
}, 120_000);
afterAll(async () => { driver?.close(); await server?.close(); await browser?.close(); });

const sys = () => page.frames().find((f: any) => f !== page.mainFrame()).evaluate(() => (window as any).__pnDevice.system());

describe("run bridge device actions", { timeout: 30_000 }, () => {
  it("get_settings returns the system settings by their tool names", async () => {
    const r = await ask({ type: "get_settings" });
    expect(r.ok).toBe(true);
    expect(r.settings).toEqual({ dark_mode: false, font_size: "default", bold_text: false, reduce_motion: false, language: "en", rtl: false });
  });
  it("set_setting writes the device's camelCase field and returns the new settings", async () => {
    const r = await ask({ type: "set_setting", key: "dark_mode", value: true });
    expect(r.ok).toBe(true);
    expect(r.settings.dark_mode).toBe(true);
    expect((await sys()).darkMode).toBe(true);
    expect(Object.keys(await sys())).not.toContain("dark_mode");
    await ask({ type: "set_setting", key: "font_size", value: "large" });
    expect((await sys()).fontSize).toBe("large");
  });
  it("language ar turns rtl on, and en turns it off", async () => {
    await ask({ type: "set_setting", key: "language", value: "ar" });
    expect(await sys()).toMatchObject({ language: "ar", rtl: true });
    await ask({ type: "set_setting", key: "language", value: "en" });
    expect(await sys()).toMatchObject({ language: "en", rtl: false });
  });
  it("an unknown key and a bad value fail with the simulator's codes and change nothing", async () => {
    const before = await sys();
    const a = await ask({ type: "set_setting", key: "wifi", value: true });
    expect(a).toMatchObject({ ok: false, code: "unknown_setting" });
    const b = await ask({ type: "set_setting", key: "dark_mode", value: "yes" });
    expect(b).toMatchObject({ ok: false, code: "bad_value" });
    const c = await ask({ type: "set_setting", key: "font_size", value: "huge" });
    expect(c).toMatchObject({ ok: false, code: "bad_value" });
    expect(await sys()).toEqual(before);
  });
  it("notifications, dismiss_notification and open_url", async () => {
    expect((await ask({ type: "notifications" })).notifications.map((n: any) => n.id)).toEqual(["n1", "n2"]);
    expect((await ask({ type: "dismiss_notification", nid: "n1" })).ok).toBe(true);
    expect((await ask({ type: "dismiss_notification", nid: "nope" })).ok).toBe(false);
    expect((await ask({ type: "notifications" })).notifications.map((n: any) => n.id)).toEqual(["n2"]);
    expect((await ask({ type: "dismiss_notification", all: true })).ok).toBe(true);
    expect((await ask({ type: "notifications" })).notifications).toEqual([]);
    expect((await ask({ type: "open_url", url: "myapp://x" })).ok).toBe(true);
    expect((await ask({ type: "open_url", url: "other://x" })).ok).toBe(false);
  });
});
