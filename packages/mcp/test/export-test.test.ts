import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { exportTest, redactDevice } from "../src/export.js";

const root = resolve(__dirname, "..");
let out = ""; let fake: http.Server; let port = 0;

const HOME = [`- heading "Shop" [ref=e1]`, `- button "Add" [ref=e2]`, `- button "Add" [ref=e3]`, `- button "Sign in" [ref=e4]`].join("\n");
const LOGIN = [`- heading "Sign in" [ref=e1]`, `- textbox "Email" [ref=e2]`, `- textbox "Password" [ref=e3]`, `- button "Continue" [ref=e4]`].join("\n");
const TYPED = LOGIN.replace(`textbox "Email" [ref=e2]`, `textbox "Email" [ref=e2]: ana@example.com`);
// A stand-in simulator: home -> tap Sign in -> login form -> type -> back to home.
let screen = "home";
beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  fake = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const b = raw ? JSON.parse(raw) : {};
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/apps") return res.end(JSON.stringify({ ok: true, apps: [{ id: "shop", name: "Shop" }] }));
    if (req.url === "/session") { screen = "home"; return res.end(JSON.stringify({ ok: true, release: "local", screen: HOME })); }
    if (b.action === "set_device") return res.end(JSON.stringify({ ok: true, screen: HOME }));
    if (b.action === "open_notification" || b.action === "device_reset") { screen = "login"; return res.end(JSON.stringify({ ok: true, screen: LOGIN })); }
    if (b.action === "tap" && b.ref === "e4") screen = "login";
    if (b.action === "type") screen = "typed";
    if (b.action === "back") screen = "home";
    res.end(JSON.stringify({ ok: true, screen: screen === "home" ? HOME : screen === "login" ? LOGIN : TYPED }));
  });
  await new Promise<void>((r) => fake.listen(0, r));
  port = (fake.address() as { port: number }).port;
});
afterAll(() => { fake?.close(); if (out) rmSync(out, { recursive: true, force: true }); });

const textOf = (r: any) => r.content[0].text as string;
async function connect() {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${port}`, PN_CONTROL: "http://127.0.0.1:1" };
  delete env.PN_APPS;
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
  return c;
}

describe("export_test", () => {
  it("is read-only", async () => {
    const c = await connect();
    const t = (await c.listTools()).tools.find((x) => x.name === "export_test");
    expect(t?.annotations?.readOnlyHint).toBe(true);
    await c.close();
  });
  it("gives a typed error for an unknown session", async () => {
    const c = await connect();
    const r: any = await c.callTool({ name: "export_test", arguments: { session: "nope" } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.code).toBe("unknown_session");
    await c.close();
  });
  it("exports open, tap, type, back with text targets, a TODO for an ambiguous one and an env placeholder for a password", async () => {
    const c = await connect();
    await c.callTool({ name: "open_app", arguments: { app: "shop", session: "s1" } });
    await c.callTool({ name: "tap", arguments: { session: "s1", ref: "e2" } }); // "Add" appears twice
    await c.callTool({ name: "tap", arguments: { session: "s1", ref: "e4" } });
    await c.callTool({ name: "type", arguments: { session: "s1", ref: "e2", text: "ana@example.com" } });
    await c.callTool({ name: "type", arguments: { session: "s1", ref: "e3", text: "hunter2" } });
    await c.callTool({ name: "back", arguments: { session: "s1" } });
    await c.callTool({ name: "screen", arguments: { session: "s1" } });
    await c.callTool({ name: "screenshot", arguments: { session: "s1" } }).catch(() => {});
    const script = textOf(await c.callTool({ name: "export_test", arguments: { session: "s1" } }));
    expect(script).toContain(`const phone = await openApp({ app: "shop" });`);
    expect(script).toContain(`// TODO: ambiguous: 2 elements match "Add"`);
    expect(script).toContain(`await phone.tap("Sign in");`);
    expect(script).toContain(`await phone.waitFor("Email");`);
    expect(script).toContain(`await phone.type("Email", "ana@example.com");`);
    expect(script).toContain(`await phone.type("Password", process.env.SHIPVO_TEST_PASSWORD!);`);
    expect(script).not.toContain("hunter2");
    expect(script).toContain(`await phone.back();`);
    expect(script).not.toMatch(/e\d+/);
    expect(script).not.toContain("screenshot");
    await c.close();
  });
});

describe("export_test through the tools", () => {
  it("redacts a payment pin sent to set_device", async () => {
    const c = await connect();
    await c.callTool({ name: "open_app", arguments: { app: "shop", session: "p1" } });
    await c.callTool({ name: "set_device", arguments: { session: "p1", payment: { nextResult: "approve", pin: "4242" } } });
    const script = textOf(await c.callTool({ name: "export_test", arguments: { session: "p1" } }));
    expect(script).toContain("process.env.SHIPVO_TEST_PAYMENT_PIN!");
    expect(script).not.toContain("4242");
    await c.close();
  });
  it("marks open_notification and device_reset as manual and reads the next tap from the new screen", async () => {
    for (const tool of ["open_notification", "device_reset"]) {
      const c = await connect();
      await c.callTool({ name: "open_app", arguments: { app: "shop", session: "n1" } });
      await c.callTool({ name: tool, arguments: { session: "n1" } });
      await c.callTool({ name: "tap", arguments: { session: "n1", ref: "e4" } }); // "Continue" on LOGIN, "Sign in" on HOME
      const script = textOf(await c.callTool({ name: "export_test", arguments: { session: "n1" } }));
      expect(script).toContain(`// TODO: not exported: ${tool} (replay by hand)`);
      expect(script).toContain(`await phone.tap("Continue");`);
      expect(script).not.toContain(`phone.tap("Sign in")`);
      await c.close();
    }
  });
});

describe("exportTest", () => {
  it("emits scroll, enter and dark exactly", () => {
    const s = exportTest({ app: "tide", dark: true }, [
      { kind: "scroll", direction: "down" },
      { kind: "scroll", direction: "right", on: { label: "Featured" } },
      { kind: "type", label: "Search", text: "rod", enter: true },
    ]);
    expect(s).toContain('openApp({ app: "tide", dark: true })');
    expect(s).toContain('  await phone.scroll("down");');
    expect(s).toContain('  await phone.scroll("right", "Featured");');
    expect(s).toContain('  await phone.type("Search", "rod", { enter: true });');
  });
  it("redactDevice leaves a device without payment alone", () => {
    const d = { online: false };
    expect(redactDevice(d)).toBe(d);
  });
  it("never writes a payment pin", () => {
    const s = exportTest({ app: "tide" }, [{ kind: "device", settings: { payment: { nextResult: "approve", pin: "__ENV_SHIPVO_TEST_PAYMENT_PIN__" } } }]);
    expect(s).toContain('"pin":process.env.SHIPVO_TEST_PAYMENT_PIN!');
  });
});
