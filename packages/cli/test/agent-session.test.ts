import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { startRunServer } from "../src/run";
import { writeRunFile } from "../src/agent-session";

let closers: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const c of closers) await c(); closers = []; });

async function host() {
  const dir = mkdtempSync(join(tmpdir(), "agent-session-")); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), "<p>app</p>");
  const s = await startRunServer({ dir, platform: "android", name: "T", port: 0 });
  closers.push(s.close);
  return s;
}
function connect(port: number, token: string, role: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/__shipvo/agent?token=${token}&role=${role}`);
  const msgs: any[] = []; ws.onmessage = (e) => msgs.push(JSON.parse(String(e.data)));
  closers.push(() => ws.close());
  const open = new Promise<void>((ok, bad) => { ws.onopen = () => ok(); ws.onerror = () => bad(new Error("refused")); });
  const next = async (pred: (m: any) => boolean) => { for (let i = 0; i < 100; i++) { const m = msgs.find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 20)); } throw new Error("no message: " + JSON.stringify(msgs)); };
  return { ws, open, msgs, next };
}
function rawUpgrade(port: number, headers: Record<string, string>, token: string) {
  return new Promise<number>((ok) => {
    const r = request({ host: "127.0.0.1", port, path: `/__shipvo/agent?token=${token}&role=driver`, headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers } });
    r.on("upgrade", (res, sock) => { sock.destroy(); ok(res.statusCode ?? 0); });
    r.on("response", (res) => { res.resume(); ok(res.statusCode ?? 0); });
    r.end();
  });
}

describe("agent session auth", () => {
  it("refuses a wrong token", async () => {
    const s = await host();
    await expect(connect(s.port, "nope", "driver").open).rejects.toThrow();
    expect(await rawUpgrade(s.port, {}, "nope")).toBe(403);
  });
  it("refuses a non-localhost Host or Origin", async () => {
    const s = await host();
    expect(await rawUpgrade(s.port, { host: "evil.example.com" }, s.token)).toBe(403);
    expect(await rawUpgrade(s.port, { origin: "http://evil.example.com" }, s.token)).toBe(403);
    expect(await rawUpgrade(s.port, { origin: "http://localhost" }, s.token)).toBe(403);
    expect(await rawUpgrade(s.port, {}, s.token)).toBe(101);
  });
  it("refuses an unknown role", async () => {
    const s = await host();
    await expect(connect(s.port, s.token, "admin").open).rejects.toThrow();
  });
});

describe("agent session flow", () => {
  it("relays a command to the tab and the result back", async () => {
    const s = await host();
    const tab = connect(s.port, s.token, "screen"); await tab.open;
    const drv = connect(s.port, s.token, "driver"); await drv.open;
    await drv.next((m) => m.type === "state" && m.screen === true);
    drv.ws.send(JSON.stringify({ id: 1, op: "tap", ref: "e3" }));
    expect(await tab.next((m) => m.id === 1)).toMatchObject({ op: "tap", ref: "e3" });
    tab.ws.send(JSON.stringify({ id: 1, ok: true, tree: "- button" }));
    expect(await drv.next((m) => m.id === 1)).toEqual({ id: 1, ok: true, tree: "- button" });
  });
  it("tells the agent when no tab is connected", async () => {
    const s = await host();
    const drv = connect(s.port, s.token, "driver"); await drv.open;
    drv.ws.send(JSON.stringify({ id: 7, op: "tap" }));
    expect((await drv.next((m) => m.id === 7)).error).toMatch(/No phone tab/);
  });
  it("pauses the agent when the person takes over, and resumes on hand back", async () => {
    const s = await host();
    const tab = connect(s.port, s.token, "screen"); await tab.open;
    const drv = connect(s.port, s.token, "driver"); await drv.open;
    tab.ws.send(JSON.stringify({ type: "takeover" }));
    expect((await drv.next((m) => m.type === "paused")).reason).toBe("the person took over");
    drv.ws.send(JSON.stringify({ id: 2, op: "tap" }));
    expect(await drv.next((m) => m.id === 2)).toMatchObject({ ok: false, error: "the person took over", paused: true });
    expect(tab.msgs.some((m) => m.id === 2)).toBe(false);
    tab.ws.send(JSON.stringify({ type: "handback" }));
    await drv.next((m) => m.type === "resumed");
    drv.ws.send(JSON.stringify({ id: 3, op: "tap" }));
    await tab.next((m) => m.id === 3);
  });
});

describe("run.json", () => {
  it("is written, git-ignored once and removed", () => {
    const root = mkdtempSync(join(tmpdir(), "run-json-"));
    const remove = writeRunFile(root, { port: 1, platform: "ios", app: "T", token: "t", pid: 2 });
    writeRunFile(root, { port: 1, platform: "ios", app: "T", token: "t", pid: 2 });
    expect(JSON.parse(readFileSync(join(root, ".shipvo/run.json"), "utf8")).token).toBe("t");
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(".shipvo/\n");
    remove();
    expect(existsSync(join(root, ".shipvo/run.json"))).toBe(false);
  });
});

describe("agent session hardening", () => {
  it("closes with 1002 on a ping over 125 bytes", async () => {
    const s = await host();
    const { connect: netConnect } = await import("node:net");
    const code = await new Promise<number>((ok, bad) => {
      const sock = netConnect(s.port, "127.0.0.1", () => {
        sock.write(`GET /__shipvo/agent?token=${s.token}&role=driver HTTP/1.1\r\nHost: 127.0.0.1:${s.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
      });
      let upgraded = false; let got = Buffer.alloc(0);
      sock.on("data", (d) => {
        if (!upgraded) {
          upgraded = true;
          const payload = Buffer.alloc(126, 1);
          sock.write(Buffer.concat([Buffer.from([0x89, 0x80 | 126, 0, 126, 0, 0, 0, 0]), payload]));
          return;
        }
        got = Buffer.concat([got, d]);
        const i = got.findIndex((b, k) => b === 0x88 && got[k + 1] === 2);
        if (i >= 0 && got.length >= i + 4) ok((got[i + 2] << 8) | got[i + 3]);
      });
      sock.on("error", bad);
      closers.push(() => { sock.destroy(); });
    });
    expect(code).toBe(1002);
  });
  it("ignores takeover from a replaced screen", async () => {
    const s = await host();
    const old = connect(s.port, s.token, "screen"); await old.open;
    const drv = connect(s.port, s.token, "driver"); await drv.open;
    const fresh = connect(s.port, s.token, "screen"); await fresh.open;
    await old.next((m) => m.type === "replaced");
    old.ws.send(JSON.stringify({ type: "takeover" }));
    await new Promise((r) => setTimeout(r, 150));
    expect(drv.msgs.some((m) => m.type === "paused")).toBe(false);
  });
});
