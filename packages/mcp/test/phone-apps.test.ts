import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(__dirname, "..");
let out = ""; let fake: http.Server; let port = 0;
const seen: any[] = [];

// A tiny simulator that follows the phone's rules for installed apps: enough to check what the tools send and how they report typed errors.
const installed = new Map<string, string>(); let current: string | null = null;
beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  fake = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    res.writeHead(200, { "content-type": "application/json" });
    const body = raw ? JSON.parse(raw) : {};
    if (req.url !== "/act") return res.end(JSON.stringify({ ok: true }));
    if (body.action !== "pending_banner") seen.push(body);
    const fail = (code: string, error: string) => res.end(JSON.stringify({ ok: false, code, error }));
    const ok = () => res.end(JSON.stringify({ ok: true, screen: `Home screen\ninstalled: ${[...installed.keys()].join(",")} current: ${current}` }));
    if (body.action === "find_apps") {
      const { findApps } = await import("../../sim/apps.mjs");
      const { query, country, language, currency, limit } = body;
      return res.end(JSON.stringify({ ok: true, apps: findApps(body.catalog ?? [], { query, country, language, currency, limit }, [...installed.keys()]) }));
    }
    if (body.action === "install_app") {
      const app = (body.catalog ?? []).find((a: any) => a.id === body.id);
      if (!app) return fail("unknown_app", "no such app");
      if (installed.has(body.id)) return fail("already_installed", "already");
      installed.set(body.id, app.name); return ok();
    }
    if (body.action === "arrange_apps" || body.action === "set_time" || body.action === "schedule_app" || body.action === "clear_schedule" || body.action === "refresh_app" || body.action === "app_activity") return res.end(JSON.stringify({ ok: true, screen: "Home screen" }));
    if (body.action === "update_app") {
      if (!installed.has(body.id)) return fail("not_installed", "not a spec app");
      if (!body.spec?.screens?.length) return fail("invalid_spec", "$.screens: Must have at least one screen.");
      return ok();
    }
    if (body.action === "export_apps") return res.end(JSON.stringify({ ok: true, format: "shipvo.phone-apps/v0", apps: [...installed].map(([id, name]) => ({ id, name, style: "android", spec: { screens: [{}] }, data: {}, settings: {} })) }));
    if (body.action === "import_apps") {
      const bad = (body.apps ?? []).findIndex((a: any) => !a.spec?.screens?.length);
      if (bad >= 0) return fail("invalid_spec", `apps[${bad}].spec.screens: Must have at least one screen.`);
      if (!body.replace && body.apps.some((a: any) => installed.has(a.id))) return fail("already_installed", "already");
      for (const a of body.apps) installed.set(a.id, a.name); return ok();
    }
    if (body.action === "create_app") {
      if (!body.spec?.screens?.length) return fail("invalid_spec", "$.screens: Must have at least one screen.");
      if (installed.has(body.id)) return fail("already_installed", "already");
      installed.set(body.id, body.name ?? body.id); if (body.open !== false) current = body.id; return ok();
    }
    if (!installed.has(body.id)) return fail("not_installed", "not installed");
    if (body.action === "pin_app" || body.action === "hide_app") return ok();
    if (body.action === "switch_app") { current = body.id; return ok(); }
    if (body.action === "uninstall_app") { installed.delete(body.id); if (current === body.id) current = null; return ok(); }
    fail("x", "x");
  });
  await new Promise<void>((r) => fake.listen(0, r));
  port = (fake.address() as { port: number }).port;
});
afterAll(() => { fake?.close(); if (out) rmSync(out, { recursive: true, force: true }); });

async function connect(extra: Record<string, string> = {}) {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${port}`, PN_CONTROL: "http://127.0.0.1:1", ...extra };
  delete env.PN_APPS; if (!extra.PN_STORE_FIXTURE) delete env.PN_STORE_FIXTURE;
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
  return c;
}
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as any;

describe("phone app tools", () => {
  it("lists the four tools with their schemas", async () => {
    const c = await connect();
    const tools = (await c.listTools()).tools.filter((t) => ["list_store_apps", "install_app", "uninstall_app", "switch_app"].includes(t.name)).sort((a, b) => a.name.localeCompare(b.name));
    expect(tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema }))).toMatchSnapshot();
    await c.close();
  });
  it("list_store_apps is store_unreachable offline and lists the fixture when asked", async () => {
    const c = await connect();
    const r = await call(c, "list_store_apps");
    expect(r.isError).toBe(true); expect(r.structuredContent.code).toBe("store_unreachable");
    await c.close();
    const f = await connect({ PN_STORE_FIXTURE: "1" });
    const ok = await call(f, "list_store_apps");
    expect(ok.structuredContent.apps.map((a: any) => a.id)).toEqual(["tide", "notes", "weather", "splitly"]);
    await f.close();
  });
  it("install, switch and uninstall return typed codes", async () => {
    const c = await connect({ PN_STORE_FIXTURE: "1" });
    const s = "s1";
    expect((await call(c, "install_app", { session: s, id: "ghost" })).structuredContent.code).toBe("unknown_app");
    expect((await call(c, "install_app", { session: s, id: "notes" })).isError).toBeFalsy();
    expect((await call(c, "install_app", { session: s, id: "notes" })).structuredContent.code).toBe("already_installed");
    expect((await call(c, "switch_app", { session: s, id: "weather" })).structuredContent.code).toBe("not_installed");
    expect((await call(c, "uninstall_app", { session: s, id: "weather" })).structuredContent.code).toBe("not_installed");
    expect((await call(c, "switch_app", { session: s, id: "notes" })).content[0].text).toMatch(/current: notes/);
    expect((await call(c, "uninstall_app", { session: s, id: "notes" })).content[0].text).toMatch(/current: null/);
    await c.close();
  });
  it("create_app sends the spec to the phone and reports a bad spec with its code", async () => {
    const c = await connect();
    const s = "s-create";
    const bad = await call(c, "create_app", { session: s, id: "gifts", spec: { spec: "shipvo.app/v0", screens: [] } });
    expect(bad.isError).toBe(true); expect(bad.structuredContent.code).toBe("invalid_spec");
    const spec = { spec: "shipvo.app/v0", app: { id: "gifts", name: "Gifts" }, screens: [{ id: "home", title: "Gifts", body: [] }] };
    const ok = await call(c, "create_app", { session: s, id: "gifts", spec, style: "ios", name: "Gift Tracker" });
    expect(ok.isError).toBeFalsy(); expect(ok.content[0].text).toMatch(/current: gifts/);
    const sent = seen.filter((b: any) => b.action === "create_app").at(-1);
    expect(sent).toMatchObject({ id: "gifts", style: "ios", name: "Gift Tracker" });
    expect(sent.spec.app.id).toBe("gifts");
    expect((await call(c, "create_app", { session: s, id: "gifts", spec })).structuredContent.code).toBe("already_installed");
    expect((await call(c, "update_app", { session: s, id: "ghost", spec })).structuredContent.code).toBe("not_installed");
    expect((await call(c, "update_app", { session: s, id: "gifts", spec: { spec: "shipvo.app/v0", screens: [] } })).structuredContent.code).toBe("invalid_spec");
    expect((await call(c, "update_app", { session: s, id: "gifts", spec })).isError).toBeFalsy();
    const ex = JSON.parse((await call(c, "export_phone_apps", { session: s, ids: ["gifts"] })).content[0].text);
    expect(seen.at(-1)).toMatchObject({ action: "export_apps", ids: ["gifts"] });
    expect(ex.apps[0]).toMatchObject({ id: "gifts", style: "android" });
    const good = { id: "copy", name: "Copy", style: "ios", spec, data: {}, settings: {} };
    expect((await call(c, "import_phone_apps", { session: s, apps: [good, { id: "x", spec: { screens: [] } }] })).structuredContent.code).toBe("invalid_spec");
    expect((await call(c, "import_phone_apps", { session: s, apps: [good] })).isError).toBeFalsy();
    expect((await call(c, "import_phone_apps", { session: s, apps: [good] })).structuredContent.code).toBe("already_installed");
    expect((await call(c, "import_phone_apps", { session: s, apps: [good], replace: true })).isError).toBeFalsy();
    expect(seen.at(-1)).toMatchObject({ action: "import_apps", replace: true });
    await c.close();
  });
  it("arrange_apps and set_phone_time send the layout and the time to the phone", async () => {
    const c = await connect();
    expect((await call(c, "arrange_apps", { session: "s-arr", id: "plan", pinned: true, schedule: { days: ["mon", "fri"], from: "08:00", to: "18:00" } })).isError).toBeFalsy();
    expect(seen.filter((b: any) => b.action === "arrange_apps").at(-1)).toMatchObject({ id: "plan", pinned: true, schedule: { days: ["mon", "fri"], from: "08:00", to: "18:00" } });
    expect((await call(c, "set_phone_time", { session: "s-arr", at: "2026-11-14T09:00:00" })).isError).toBeFalsy();
    expect(seen.filter((b: any) => b.action === "set_time").at(-1)).toMatchObject({ at: "2026-11-14T09:00:00" });
    await c.close();
  });
  it("schedule_app and clear_schedule reach the phone", async () => {
    const c = await connect();
    expect((await call(c, "schedule_app", { session: "s-sch", id: "plan", days: ["mon"], from: "08:00", to: "10:00" })).isError).toBeFalsy();
    expect(seen.filter((b: any) => b.action === "schedule_app").at(-1)).toMatchObject({ id: "plan", days: ["mon"], from: "08:00", to: "10:00" });
    expect((await call(c, "clear_schedule", { session: "s-sch", id: "plan" })).isError).toBeFalsy();
    expect(seen.filter((b: any) => b.action === "clear_schedule").at(-1)).toMatchObject({ id: "plan" });
    await c.close();
  });
  it("refresh_app asks the phone to fetch an app's data now", async () => {
    const c = await connect();
    expect((await call(c, "refresh_app", { session: "s-ref", id: "prices" })).isError).toBeFalsy();
    expect(seen.filter((b: any) => b.action === "refresh_app").at(-1)).toMatchObject({ id: "prices" });
    expect((await call(c, "app_activity", { session: "s-ref", id: "prices", limit: 5 })).isError).toBeFalsy();
    expect(seen.filter((b: any) => b.action === "app_activity").at(-1)).toMatchObject({ id: "prices", limit: 5 });
    await c.close();
  });
  it("pin_app and hide_app reach the phone and report not_installed", async () => {
    const c = await connect();
    const s = "s-pin";
    await call(c, "create_app", { session: s, id: "tide", spec: { spec: "shipvo.app/v0", screens: [{ id: "home", title: "T", body: [] }] } });
    expect((await call(c, "pin_app", { session: s, id: "tide", pinned: true })).isError).toBeFalsy();
    expect((await call(c, "hide_app", { session: s, id: "tide", hidden: true })).isError).toBeFalsy();
    expect(seen.filter((b: any) => b.action === "pin_app").at(-1)).toMatchObject({ id: "tide", pinned: true });
    expect(seen.filter((b: any) => b.action === "hide_app").at(-1)).toMatchObject({ id: "tide", hidden: true });
    expect((await call(c, "pin_app", { session: s, id: "ghost", pinned: true })).structuredContent.code).toBe("not_installed");
    expect((await call(c, "hide_app", { session: s, id: "ghost", hidden: true })).structuredContent.code).toBe("not_installed");
    await c.close();
  });
  it("marketplace apps get an app:// url that the sim resolves like open_app", async () => {
    const cp = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(req.url === "/apps/public" ? JSON.stringify({ apps: [{ app_id: "tide", name: "Tide", latest_release: 13 }, { app_id: "fresh", name: "Fresh" }] }) : "{}");
    });
    await new Promise<void>((r) => cp.listen(0, r));
    const cport = (cp.address() as { port: number }).port;
    const c = await connect({ PN_CONTROL: `http://127.0.0.1:${cport}` });
    const r = await call(c, "list_store_apps");
    expect(r.structuredContent.apps.map((a: any) => a.url)).toEqual(["app://tide@r13", "app://fresh@latest"]);
    await c.close(); cp.close();
  });
});

describe("find_apps", () => {
  it("is store_unreachable when the Store cannot be reached", async () => {
    const c = await connect();
    const r = await call(c, "find_apps", { session: "s1", query: "split bills" });
    expect(r.isError).toBe(true); expect(r.structuredContent.code).toBe("store_unreachable");
    await c.close();
  });
  it("sends the fixture catalog to the phone and returns the best match first", async () => {
    const c = await connect({ PN_STORE_FIXTURE: "1" });
    const r = await call(c, "find_apps", { session: "s-find", query: "split bills" });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.apps[0].id).toBe("splitly");
    const sent = seen.filter((b: any) => b.action === "find_apps").at(-1);
    expect(sent.catalog.map((a: any) => a.id)).toContain("splitly");
    const usd = await call(c, "find_apps", { session: "s-find", query: "split bills", currency: "USD" });
    expect(usd.isError).toBeFalsy();
    expect(usd.structuredContent.apps.map((a: any) => a.id)).not.toContain("splitly");
    await c.close();
  });
});
