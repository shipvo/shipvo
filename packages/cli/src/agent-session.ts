// The session host for `shipvo run`: a WebSocket at /__shipvo/agent on the run server's port.
// The person's tab connects as the "screen"; the coding agent (via @shipvo/mcp) connects as the "driver".
// The host only relays JSON between them and enforces who may connect and who is in control.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const AGENT_PATH = "/__shipvo/agent";
const MAX_MESSAGE = 1024 * 1024;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Encodes one unmasked text frame (server to client). */
export function encodeFrame(text: string): Buffer {
  const p = Buffer.from(text);
  const head = p.length < 126 ? Buffer.from([0x81, p.length]) : p.length < 65536 ? Buffer.from([0x81, 126, p.length >> 8, p.length & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(p.length), 2); return b; })();
  return Buffer.concat([head, p]);
}

/** Reads client frames from a socket. Text, ping and close only; fragmented or binary frames close the socket. */
function readFrames(sock: Socket, onText: (t: string) => void) {
  let buf = Buffer.alloc(0);
  const close = (code: number) => { try { sock.end(Buffer.from([0x88, 2, code >> 8, code & 255])); } catch { /* already closed */ } };
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 15, fin = buf[0] & 128, masked = buf[1] & 128;
      let len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; const big = buf.readBigUInt64BE(2); if (big > BigInt(MAX_MESSAGE)) return close(1009); len = Number(big); off = 10; }
      if (len > MAX_MESSAGE) return close(1009);
      if (!masked) return close(1002);
      if (op >= 8 && (len > 125 || !fin)) return close(1002);
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + len);
      if (op === 8) return void sock.end(Buffer.from([0x88, 0]));
      if (op === 9) { sock.write(Buffer.concat([Buffer.from([0x8a, data.length]), data.subarray(0, 125)])); continue; }
      if (op === 1 && fin) onText(data.toString("utf8"));
      else if (op !== 10) return close(1003);
    }
  });
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** Decides whether an upgrade request may connect. Returns a reason when refused. */
export function checkUpgrade(req: IncomingMessage, token: string, port: number): { role: "screen" | "driver" } | { refused: string } {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) return { refused: "localhost only" };
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.has(host)) return { refused: "localhost only" };
  const origin = req.headers.origin;
  if (origin) {
    try { const o = new URL(origin); if (!LOCAL_HOSTS.has(o.hostname)) return { refused: "localhost only" }; if (o.port && Number(o.port) !== port) return { refused: "localhost only" }; }
    catch { return { refused: "localhost only" }; }
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const given = Buffer.from(url.searchParams.get("token") ?? "");
  const want = Buffer.from(token);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return { refused: "wrong token" };
  const role = url.searchParams.get("role");
  if (role !== "screen" && role !== "driver") return { refused: "role must be screen or driver" };
  return { role };
}

/**
 * Attaches the session host to a run server. Messages:
 *  driver -> screen: any JSON with an `id` (a command). While the person is in control the host answers `{id, ok:false, error}` itself.
 *  screen -> driver: any JSON (results, tree). `{type:"takeover"}` pauses the driver; `{type:"handback"}` resumes it.
 */
export function attachAgentSession(server: Server, getPort: () => number, token = randomBytes(24).toString("hex")) {
  let screen: Socket | undefined; let driver: Socket | undefined; let paused = false;
  const send = (s: Socket | undefined, m: unknown) => { if (s && !s.destroyed) s.write(encodeFrame(JSON.stringify(m))); };
  const state = () => ({ type: "state", screen: !!screen, paused });
  server.on("upgrade", (req, sock: Socket) => {
    const refuse = (code: string, why: string) => { sock.end(`HTTP/1.1 ${code}\r\nconnection: close\r\ncontent-length: ${why.length}\r\n\r\n${why}`); };
    if ((req.url ?? "").split("?")[0] !== AGENT_PATH) return refuse("404 Not Found", "not found");
    const c = checkUpgrade(req, token, getPort());
    if ("refused" in c) return refuse("403 Forbidden", c.refused);
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") return refuse("400 Bad Request", "bad request");
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ${createHash("sha1").update(key + GUID).digest("base64")}\r\n\r\n`);
    const role = c.role;
    if (role === "screen") { send(screen, { type: "replaced" }); screen?.end(); screen = sock; paused = false; send(driver, state()); }
    else { driver?.end(); driver = sock; send(sock, state()); }
    sock.on("close", () => {
      if (role === "screen" && screen === sock) { screen = undefined; send(driver, state()); }
      if (role === "driver" && driver === sock) driver = undefined;
    });
    sock.on("error", () => sock.destroy());
    readFrames(sock, (text) => {
      let m: { type?: string; id?: unknown };
      try { m = JSON.parse(text); } catch { return; }
      if (!m || typeof m !== "object") return;
      if (role === "screen") {
        if (screen !== sock) return;
        if (m.type === "takeover") { paused = true; send(driver, { type: "paused", reason: "the person took over" }); }
        else if (m.type === "handback") { paused = false; send(driver, { type: "resumed" }); }
        else send(driver, m);
      } else if (m.id !== undefined) {
        if (!screen) send(sock, { id: m.id, ok: false, error: "No phone tab is connected. Ask the person to open the shipvo run page." });
        else if (paused) send(sock, { id: m.id, ok: false, error: "the person took over", paused: true });
        else send(screen, m);
      }
    });
  });
  // Upgraded sockets are not HTTP connections, so `server.close()` would wait for them forever. Call this first.
  const closeSockets = () => { screen?.destroy(); driver?.destroy(); };
  return { token, closeSockets, state: () => ({ screen: !!screen, driver: !!driver, paused }) };
}

export type RunFile = { port: number; platform: string; app: string; token: string; pid: number };

/** Writes `.shipvo/run.json` in the project and makes sure git ignores `.shipvo/`. Returns a function that removes it. */
export function writeRunFile(root: string, info: RunFile): () => void {
  const dir = join(root, ".shipvo"); mkdirSync(dir, { recursive: true });
  const file = join(dir, "run.json");
  writeFileSync(file, JSON.stringify(info, null, 2) + "\n", { mode: 0o600 });
  const gi = join(root, ".gitignore");
  const cur = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (!/^\/?\.shipvo\/?\s*$/m.test(cur)) appendFileSync(gi, `${cur && !cur.endsWith("\n") ? "\n" : ""}.shipvo/\n`);
  return () => rmSync(file, { force: true });
}
