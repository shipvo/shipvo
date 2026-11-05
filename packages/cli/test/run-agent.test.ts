import { describe, it, expect } from "vitest";
import { request as httpRequest } from "node:http";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRunServer, ensureShipvoIgnored } from "../src/run";
import { isLoopback } from "../src/run-protocol";
import { renderFrame } from "../../sim/frame.mjs";

const setup = async () => {
  const dir = mkdtempSync(join(tmpdir(), "shipvo-agent-"));
  const s = await startRunServer({ dir, platform: "ios", name: "Tide", projectDir: dir, render: renderFrame });
  return { dir, s, url: (role: string, token = s.token) => `ws://127.0.0.1:${s.port}/__shipvo/agent?role=${role}&token=${token}` };
};
const open = (url: string) => new Promise<WebSocket>((ok, fail) => { const w = new WebSocket(url); w.onopen = () => ok(w); w.onerror = () => fail(new Error("refused")); });
const next = (w: WebSocket) => new Promise<string>((ok) => { w.onmessage = (e) => ok(String(e.data)); });

describe("run agent channel", () => {
  it("refuses a wrong or missing token", async () => {
    const { s, url } = await setup();
    await expect(open(url("driver", "nope"))).rejects.toThrow();
    await expect(open(`ws://127.0.0.1:${s.port}/__shipvo/agent?role=driver`)).rejects.toThrow();
    const r = await fetch(`http://127.0.0.1:${s.port}/__shipvo/agent?role=driver&token=x`);
    expect(r.status).toBe(404); // plain GET is not an upgrade
    await s.close();
  });
  it("recognises loopback addresses only", () => {
    for (const a of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) expect(isLoopback(a)).toBe(true);
    for (const a of ["10.0.0.5", "192.168.1.2", "::ffff:10.0.0.5", "2001:db8::1", undefined]) expect(isLoopback(a)).toBe(false);
  });
  it("writes run.json while running and removes it on close", async () => {
    const { dir, s } = await setup();
    const info = JSON.parse(readFileSync(join(dir, ".shipvo", "run.json"), "utf8"));
    expect(Object.keys(info).sort()).toEqual(["app", "pid", "platform", "port", "token"]);
    expect(info).toMatchObject({ port: s.port, platform: "ios", app: "Tide", token: s.token, pid: process.pid });
    expect(s.token.length).toBeGreaterThanOrEqual(32);
    await s.close();
    expect(existsSync(join(dir, ".shipvo", "run.json"))).toBe(false);
  });
  it("relays driver messages to the screen and replies back", async () => {
    const { s, url } = await setup();
    const screen = await open(url("screen")); const driver = await open(url("driver"));
    const got = next(screen);
    driver.send(JSON.stringify({ id: 1, type: "tap", ref: "e3" }));
    expect(JSON.parse(await got)).toEqual({ id: 1, type: "tap", ref: "e3" });
    const back = next(driver);
    screen.send(JSON.stringify({ id: 1, type: "result", ok: true, big: "x".repeat(70000) }));
    const reply = JSON.parse(await back);
    expect(reply).toMatchObject({ id: 1, ok: true });
    expect(reply.big.length).toBe(70000);
    screen.close(); driver.close();
    await s.close();
  });
});

describe("ensureShipvoIgnored", () => {
  it("adds the line once", () => {
    const dir = mkdtempSync(join(tmpdir(), "shipvo-gi-"));
    writeFileSync(join(dir, ".gitignore"), "node_modules/");
    ensureShipvoIgnored(dir); ensureShipvoIgnored(dir);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe("node_modules/\n.shipvo/\n");
  });
  it("creates the file and keeps an existing entry", () => {
    const dir = mkdtempSync(join(tmpdir(), "shipvo-gi-"));
    ensureShipvoIgnored(dir);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe(".shipvo/\n");
  });
});

describe("shipvo init", () => {
  it("writes a .gitignore that ignores .shipvo/", () => {
    expect(readFileSync(join(__dirname, "../src/init.ts"), "utf8")).toMatch(/w\("\.gitignore", `[^`]*\\n\.shipvo\/\\n`\)/);
  });
});

describe("page credential", () => {
  it("is not the agent token, and only opens the screen role", async () => {
    const { s } = await setup();
    const html = await (await fetch(`http://127.0.0.1:${s.port}/`)).text();
    expect(html).not.toContain(s.token);
    const page = /data-token="([0-9a-f]+)"/.exec(html)![1];
    expect(page).not.toBe(s.token);
    const open = (role: string) => new Promise<string>((ok) => {
      const ws = new WebSocket(`ws://127.0.0.1:${s.port}/__shipvo/agent?role=${role}&token=${page}`);
      ws.onopen = () => { ws.close(); ok("open"); };
      ws.onerror = () => ok("refused");
    });
    expect(await open("screen")).toBe("open");
    expect(await open("driver")).toBe("refused");
    await s.close();
  });
});

describe("run server Host and Origin checks", () => {
  const raw = (port: number, headers: Record<string, string>, upgrade: boolean, token = "") => new Promise<number>((ok, fail) => {
    const req = httpRequest({ host: "127.0.0.1", port, path: upgrade ? `/__shipvo/agent?role=driver&token=${token}` : "/", headers: upgrade ? { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers } : headers });
    req.on("response", (r) => { ok(r.statusCode ?? 0); r.resume(); });
    req.on("upgrade", (r, sock) => { ok(r.statusCode ?? 0); sock.destroy(); });
    req.on("error", fail); req.end();
  });
  it("refuses a wrong Host for the page and the bridge script", async () => {
    const { s } = await setup();
    expect(await raw(s.port, { Host: "evil.example" }, false)).toBe(403);
    expect(await raw(s.port, { Host: `evil.example:${s.port}` }, false)).toBe(403);
    expect(await raw(s.port, { Host: `127.0.0.1:${s.port}` }, false)).toBe(200);
    expect(await raw(s.port, { Host: `localhost:${s.port}` }, false)).toBe(200);
    await s.close();
  });
  it("refuses a WebSocket upgrade with a wrong Host", async () => {
    const { s } = await setup();
    expect(await raw(s.port, { Host: "evil.example" }, true, s.token)).toBe(403);
    expect(await raw(s.port, { Host: `127.0.0.1:${s.port}` }, true, s.token)).toBe(101);
    await s.close();
  });
  it("refuses a WebSocket upgrade with a foreign Origin", async () => {
    const { s } = await setup();
    const host = `127.0.0.1:${s.port}`;
    expect(await raw(s.port, { Host: host, Origin: "http://evil.example" }, true, s.token)).toBe(403);
    expect(await raw(s.port, { Host: host, Origin: `http://127.0.0.1:${s.port + 1}` }, true, s.token)).toBe(403);
    expect(await raw(s.port, { Host: host, Origin: `http://${host}` }, true, s.token)).toBe(101);
    await s.close();
  });
});
