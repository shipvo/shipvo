// A small server-side WebSocket (RFC 6455) on `node:http` upgrade, enough for JSON text messages.
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

export type Peer = { send(text: string): void; close(): void };

const MAX = 1 << 20;

function frame(op: number, payload: Buffer): Buffer {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : (() => {
    const h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return h;
  })();
  return Buffer.concat([head, payload]);
}

/** Completes the handshake and returns a peer. `onText` gets each complete text message; `onClose` fires once. */
export function acceptWebSocket(req: IncomingMessage, socket: Duplex, onText: (t: string) => void, onClose: () => void): Peer | undefined {
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || req.headers.upgrade?.toLowerCase() !== "websocket") { socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); return undefined; }
  const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  let buf = Buffer.alloc(0); let parts: Buffer[] = []; let closed = false;
  const done = () => { if (!closed) { closed = true; onClose(); } };
  const shut = () => { if (!closed && socket.writable) socket.write(frame(8, Buffer.alloc(0))); socket.end(); done(); };
  socket.on("end", shut); socket.on("close", done); socket.on("error", () => { socket.destroy(); done(); });
  socket.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 15, fin = (buf[0] & 128) !== 0, masked = (buf[1] & 128) !== 0;
      let len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; const big = buf.readBigUInt64BE(2); if (big > BigInt(MAX)) return shut(); len = Number(big); off = 10; }
      if (!masked || len > MAX) return shut(); // clients must mask
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + len);
      if (op === 8) return shut();
      if (op === 9) { socket.write(frame(10, data)); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 2 || op === 0) {
        parts.push(data);
        if (parts.reduce((s, p) => s + p.length, 0) > MAX) return shut();
        if (fin) { const text = Buffer.concat(parts).toString("utf8"); parts = []; if (op !== 2) onText(text); }
      }
    }
  });
  return { send: (t) => { if (!closed) socket.write(frame(1, Buffer.from(t))); }, close: shut };
}
