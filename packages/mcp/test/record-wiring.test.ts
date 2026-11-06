import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// The real tap path: the MCP `tap` tool asks the simulator where the ref is, and the recording shows a dot there.
const root = resolve(__dirname, "..");
const have = (b: string) => spawnSync(b, ["-version"]).status === 0;
const required = process.env.SHIPVO_REQUIRE_FFMPEG === "1";
const chromiumPath = () => { try { return process.env.SHIPVO_CHROMIUM ?? createRequire(import.meta.url)("playwright").chromium.executablePath(); } catch { return ""; } };
const ok = have("ffmpeg") && have("ffprobe") && (required || (!!chromiumPath() && existsSync(chromiumPath())));
if (required && !(have("ffmpeg") && have("ffprobe"))) throw new Error("SHIPVO_REQUIRE_FFMPEG=1 but ffmpeg or ffprobe is missing");

let dist = ""; let out = ""; let sim: http.Server; let frame: http.Server; let simPort = 0; let framePort = 0;
const acts: any[] = []; let box: object | null = { x: 0.25, y: 0.25, w: 0.1, h: 0.1 };
const listen = (s: http.Server) => new Promise<number>((r) => s.listen(0, () => r((s.address() as { port: number }).port)));
beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "rec-wire-")); dist = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", dist], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  sim = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/act") { const body = JSON.parse(raw); acts.push(body); return res.end(JSON.stringify(body.action === "locate" ? { ok: true, box } : { ok: true, screen: '- button "Go" [ref=e1]' })); }
    res.end(JSON.stringify({ ok: true }));
  });
  frame = http.createServer((_, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<body style='margin:0;background:#136'></body>"); });
  simPort = await listen(sim); framePort = await listen(frame);
});
afterAll(() => { sim?.close(); frame?.close(); for (const d of [out, dist]) if (d) rmSync(d, { recursive: true, force: true }); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pixels = (f: string, t: number, x: number, y: number) =>
  spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", f, "-frames:v", "1", "-vf", `crop=120:120:${x}:${y}`, "-pix_fmt", "gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 24 }).stdout;
const mean = (b: Buffer) => b.reduce((a, v) => a + v, 0) / b.length;

async function record(tool: string, args: Record<string, unknown>) {
  const env = { ...(process.env as Record<string, string>), PN_SIM: `http://127.0.0.1:${simPort}`, PN_CONTROL: "http://127.0.0.1:1", SHIPVO_FRAME_URL: `http://127.0.0.1:${framePort}/` };
  delete env.PN_APPS;
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(dist, "server.js")], env }));
  try {
    await c.callTool({ name: "record_start", arguments: { format: "1:1", title: "wire", dir: out } });
    await sleep(400); const t0 = Date.now();
    await c.callTool({ name: tool, arguments: { session: "menu-1", ...args } });
    await sleep(300);
    const r: any = await c.callTool({ name: "record_stop", arguments: {} });
    return { file: r.structuredContent.file as string, t: (Date.now() - t0) / 1000 };
  } finally { await c.close(); }
}
const diff = (file: string, t: number, x: number, y: number) => Math.abs(mean(pixels(file, t + 0.15, x, y)) - mean(pixels(file, 0.1, x, y)));

describe.skipIf(!ok)("recording overlays through the MCP tools", () => {
  it("tap draws a dot where the simulator says the element is", async () => {
    box = { x: 0.25, y: 0.25, w: 0.1, h: 0.1 }; acts.length = 0;
    const r = await record("tap", { ref: "e1" });
    expect(acts.map((a) => a.action)).toEqual(["locate", "tap"]);
    expect(diff(r.file, 0.45, 210, 210)).toBeGreaterThan(5); // dot centred at 25%/25% of 1080
    expect(diff(r.file, 0.45, 800, 800)).toBeLessThan(1);
  }, 90000);

  it("tap draws nothing when the simulator cannot place the element", async () => {
    box = null;
    const r = await record("tap", { ref: "e1" });
    expect(diff(r.file, 0.45, 480, 480)).toBeLessThan(1);
    expect(diff(r.file, 0.45, 210, 210)).toBeLessThan(1);
  }, 90000);

  it("scroll with a ref asks for the element and draws no trail at the page centre when unknown", async () => {
    box = null; acts.length = 0;
    const r = await record("scroll", { ref: "e1", direction: "right" });
    expect(acts[0].action).toBe("locate");
    expect(diff(r.file, 0.45, 480, 480)).toBeLessThan(1);
  }, 90000);
});
