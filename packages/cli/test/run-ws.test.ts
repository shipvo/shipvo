import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { acceptWebSocket, type Peer } from "../src/run-ws.js";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function maskedFrame(op: number, payload: Buffer, fin = true): Buffer {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([(fin ? 0x80 : 0) | op, 0x80 | n])
    : n < 65536 ? Buffer.from([(fin ? 0x80 : 0) | op, 0x80 | 126, n >> 8, n & 255])
    : (() => { const h = Buffer.alloc(10); h[0] = (fin ? 0x80 : 0) | op; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(n), 2); return h; })();
  const mask = Buffer.from([1, 2, 3, 4]);
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
  return Buffer.concat([head, mask, body]);
}

type Ctx = { texts: string[]; closes: number; peer?: Peer; client: Socket; received: Buffer[]; key: string; handshake: Promise<string>; ended: Promise<void> };
let server: Server | undefined; let sockets: Socket[] = [];
afterEach(async () => { sockets.forEach((s) => s.destroy()); sockets = []; await new Promise((r) => (server ? server.close(() => r(null)) : r(null))); server = undefined; });

async function start(headers: Record<string, string> = {}, noKey = false): Promise<Ctx> {
  const key = randomBytes(16).toString("base64");
  const ctx = { texts: [] as string[], closes: 0 } as Ctx;
  server = createServer();
  server.on("upgrade", (req, socket) => { sockets.push(socket as Socket); ctx.peer = acceptWebSocket(req, socket, (t) => ctx.texts.push(t), () => { ctx.closes++; }); });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const client = connect(port, "127.0.0.1"); sockets.push(client);
  ctx.client = client; ctx.key = key; ctx.received = [];
  ctx.ended = new Promise((r) => client.on("close", () => r()));
  let hs = "";
  ctx.handshake = new Promise((resolve) => {
    client.on("data", (d) => {
      if (!hs.includes("\r\n\r\n")) {
        hs += d.toString("latin1");
        const i = hs.indexOf("\r\n\r\n");
        if (i >= 0) { resolve(hs.slice(0, i)); const rest = Buffer.from(hs.slice(i + 4), "latin1"); if (rest.length) ctx.received.push(rest); }
      } else ctx.received.push(d);
    });
  });
  const h = { Host: "x", Upgrade: "websocket", Connection: "Upgrade", ...(noKey ? {} : { "Sec-WebSocket-Key": key }), "Sec-WebSocket-Version": "13", ...headers };
  client.write(`GET / HTTP/1.1\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`);
  return ctx;
}
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

describe("acceptWebSocket", () => {
  it("answers the handshake with the RFC 6455 accept value", async () => {
    const c = await start();
    const hs = await c.handshake;
    const accept = createHash("sha1").update(c.key + GUID).digest("base64");
    expect(hs).toContain("101 Switching Protocols");
    expect(hs).toContain(`Sec-WebSocket-Accept: ${accept}`);
  });

  it("rejects an upgrade with no key using 400", async () => {
    const c = await start({}, true);
    expect(await c.handshake).toContain("400 Bad Request");
    expect(c.peer).toBeUndefined();
  });

  it("rejects an upgrade header that is not websocket", async () => {
    const c = await start({ Upgrade: "h2c" });
    expect(await c.handshake).toContain("400 Bad Request");
  });

  it("delivers masked text frames, including 16-bit and 64-bit lengths", async () => {
    const c = await start(); await c.handshake;
    const mid = "m".repeat(300), big = "b".repeat(70000);
    c.client.write(maskedFrame(1, Buffer.from("hi")));
    c.client.write(maskedFrame(1, Buffer.from(mid)));
    c.client.write(maskedFrame(1, Buffer.from(big)));
    await tick(150);
    expect(c.texts).toEqual(["hi", mid, big]);
  });

  it("reassembles a frame split across TCP chunks", async () => {
    const c = await start(); await c.handshake;
    const f = maskedFrame(1, Buffer.from("split me"));
    c.client.write(f.subarray(0, 1)); await tick(20);
    c.client.write(f.subarray(1, 5)); await tick(20);
    c.client.write(f.subarray(5));
    await tick();
    expect(c.texts).toEqual(["split me"]);
  });

  it("joins fragmented messages and allows a ping in between", async () => {
    const c = await start(); await c.handshake;
    c.client.write(maskedFrame(1, Buffer.from("hel"), false));
    c.client.write(maskedFrame(9, Buffer.from("p"))); 
    c.client.write(maskedFrame(0, Buffer.from("lo"), true));
    await tick();
    expect(c.texts).toEqual(["hello"]);
    const out = Buffer.concat(c.received);
    expect(out[0]).toBe(0x8a); // pong
    expect(out.subarray(2, 3).toString()).toBe("p");
  });

  it("keeps multi-byte characters intact across fragments", async () => {
    const c = await start(); await c.handshake;
    const b = Buffer.from("é€");
    c.client.write(maskedFrame(1, b.subarray(0, 1), false));
    c.client.write(maskedFrame(0, b.subarray(1), true));
    await tick();
    expect(c.texts).toEqual(["é€"]);
  });

  it("ignores binary messages", async () => {
    const c = await start(); await c.handshake;
    c.client.write(maskedFrame(2, Buffer.from([1, 2, 3])));
    c.client.write(maskedFrame(1, Buffer.from("after")));
    await tick();
    expect(c.texts).toEqual(["after"]);
  });

  it("closes on an unmasked client frame", async () => {
    const c = await start(); await c.handshake;
    c.client.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));
    await c.ended;
    expect(c.texts).toEqual([]);
    expect(c.closes).toBe(1);
  });

  it("closes when a frame declares more than 1 MiB", async () => {
    const c = await start(); await c.handshake;
    const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt((1 << 20) + 1), 2);
    c.client.write(h);
    await c.ended;
    expect(c.closes).toBe(1);
  });

  it("closes when fragments add up past 1 MiB", async () => {
    const c = await start(); await c.handshake;
    const part = Buffer.alloc(600 * 1024, 97);
    c.client.write(maskedFrame(1, part, false));
    c.client.write(maskedFrame(0, part, true));
    await c.ended;
    expect(c.texts).toEqual([]);
    expect(c.closes).toBe(1);
  });

  it("replies to a close frame with a close frame and fires onClose once", async () => {
    const c = await start(); await c.handshake;
    c.client.write(maskedFrame(8, Buffer.alloc(0)));
    await c.ended;
    expect(Buffer.concat(c.received)[0]).toBe(0x88);
    expect(c.closes).toBe(1);
  });

  it("send writes an unmasked text frame; send after close is a no-op", async () => {
    const c = await start(); await c.handshake;
    c.peer!.send("pong");
    await tick();
    const out = Buffer.concat(c.received);
    expect([out[0], out[1]]).toEqual([0x81, 4]);
    expect(out.subarray(2).toString()).toBe("pong");
    c.peer!.close();
    await c.ended;
    expect(() => c.peer!.send("late")).not.toThrow();
    expect(c.closes).toBe(1);
  });

  it("fires onClose when the client drops the socket", async () => {
    const c = await start(); await c.handshake;
    c.client.destroy();
    await tick(100);
    expect(c.closes).toBe(1);
  });
});
