import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Recorder, RecorderError } from "../src/recorder.js";

const root = resolve(__dirname, "..");
const have = (bin: string) => spawnSync(bin, ["-version"]).status === 0;
const required = process.env.SHIPVO_REQUIRE_FFMPEG === "1";
const ffmpegOk = have("ffmpeg") && have("ffprobe");
const chromiumPath = () => { try { return process.env.SHIPVO_CHROMIUM ?? createRequire(import.meta.url)("playwright").chromium.executablePath(); } catch { return ""; } };
const browserOk = !!chromiumPath() && existsSync(chromiumPath());
const encodeOk = ffmpegOk && (browserOk || required);
if (required && !ffmpegOk) throw new Error("SHIPVO_REQUIRE_FFMPEG=1 but ffmpeg or ffprobe is missing");

let page: http.Server; let url = ""; let out = ""; let dist = "";
beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "rec-")); dist = mkdtempSync(join(root, "dist-test-"));
  page = http.createServer((_, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<body style='margin:0;background:#136'><h1 style='color:#fff'>Phone frame</h1></body>"); });
  await new Promise<void>((r) => page.listen(0, r));
  url = `http://127.0.0.1:${(page.address() as { port: number }).port}/`;
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", dist], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
});
afterAll(() => { page?.close(); for (const d of [out, dist]) if (d) rmSync(d, { recursive: true, force: true }); });

const probe = (file: string) => {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name:format=duration", "-of", "json", file], { encoding: "utf8" });
  const j = JSON.parse(r.stdout); return { width: j.streams[0].width, height: j.streams[0].height, codec: j.streams[0].codec_name, duration: Number(j.format.duration) };
};
// Stand-in for Playwright: the first screenshot is slow, later ones are fast.
const fake = vi.hoisted(() => ({ on: false, firstDelay: 0, jpeg: Buffer.alloc(0) }));
// Passes through to the real playwright unless `fake.on` is set.
vi.mock("playwright", async (orig) => {
  const real: any = await orig();
  const chromium = { ...real.chromium, executablePath: real.chromium.executablePath, launch: async (...a: unknown[]) => {
    if (!fake.on) return real.chromium.launch(...a);
    let n = 0;
    const page = { goto: async () => {}, screenshot: async () => { if (n++ === 0) await new Promise((r) => setTimeout(r, fake.firstDelay)); else await new Promise((r) => setTimeout(r, 40)); return fake.jpeg; } };
    return { newPage: async () => page, close: async () => {} };
  } };
  return { ...real, default: { ...real, chromium }, chromium };
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!encodeOk)("Recorder", () => {
  it.each([["9:16", 1080, 1920], ["16:9", 1920, 1080], ["1:1", 1080, 1080]] as const)("writes an H.264 MP4 for %s", async (format, width, height) => {
    const r = new Recorder();
    await r.start({ url, format, title: "My Demo", dir: out });
    await sleep(500); const a = r.marker("first"); await sleep(500); const b = r.marker("second"); await sleep(300);
    const res = await r.stop();
    expect(res).toMatchObject({ width, height });
    expect(res.file).toMatch(/my-demo-\d{14}\.mp4$/);
    expect(existsSync(res.file)).toBe(true);
    const p = probe(res.file);
    expect(p).toMatchObject({ width, height, codec: "h264" });
    expect(Math.abs(p.duration - res.duration_s)).toBeLessThan(0.7);
    expect(res.duration_s).toBeGreaterThanOrEqual(1.3);
    expect(res.chapters.map((c) => c.caption)).toEqual(["first", "second"]);
    expect(a.t).toBeGreaterThan(0); expect(b.t).toBeGreaterThan(a.t); expect(res.duration_s).toBeGreaterThanOrEqual(b.t);
  }, 60000);

  it("refuses a second start while recording", async () => {
    const r = new Recorder(); await r.start({ url, dir: out });
    await expect(r.start({ url, dir: out })).rejects.toMatchObject({ code: "recording_active" });
    await r.stop();
  }, 60000);
});

describe.skipIf(!ffmpegOk)("Recorder clock with a slow first screenshot", () => {
  it("duration_s and chapter times match the video, not the first-screenshot delay", async () => {
    const jpg = join(out, "frame.jpg");
    // The frame is 64x64 on purpose: the recorder scales it, and this test only checks the clock.
    spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x113366:s=64x64", "-frames:v", "1", jpg]);
    fake.jpeg = readFileSync(jpg); fake.firstDelay = 800; fake.on = true;
    try {
      const r = new Recorder();
      await r.start({ url, format: "1:1", title: "slow-first", dir: out });
      const a = r.marker("first"); await sleep(1300);
      const res = await r.stop();
      expect(a.t).toBeLessThan(0.3);
      expect(Math.abs(probe(res.file).duration - res.duration_s)).toBeLessThan(0.3);
    } finally { fake.on = false; }
  }, 60000);
});

describe("Recorder without a recording", () => {
  it("stop and marker throw no_recording", async () => {
    const r = new Recorder();
    await expect(r.stop()).rejects.toMatchObject({ code: "no_recording" });
    expect(() => r.marker("x")).toThrow(/record_start/);
    expect(() => r.marker("x")).toThrow(RecorderError);
  });
});

describe("Recorder stop race", () => {
  it("refuses start while stop is still encoding", async () => {
    const r: any = new Recorder();
    let finish!: (c: number) => void;
    r.running = true; r.file = "a.mp4"; r.t0 = Date.now();
    r.encode = () => new Promise<number>((res) => { finish = res; });
    const stopping = r.stop();
    expect(r.active).toBe(true);
    await expect(r.start({ url, dir: out })).rejects.toMatchObject({ code: "recording_active" });
    expect(r.file).toBe("a.mp4");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    finish(0);
    expect(await stopping).toMatchObject({ file: "a.mp4" });
    expect(r.active).toBe(false);
  });
});

describe("Recorder frame timing (no ffmpeg needed)", () => {
  it("writes each frame's duration from its capture time and removes the frames dir at stop", async () => {
    const dir = mkdtempSync(join(out, "ft-")); const framesDir = join(dir, "x.frames"); mkdirSync(framesDir);
    const r: any = new Recorder();
    const t = 1_000_000; let listText = "";
    r.running = true; r.file = join(dir, "x.mp4"); r.raw = join(dir, "x.raw.mp4"); r.framesDir = framesDir; r.t0 = t; r.frames = [t, t + 1000, t + 1100];
    const enc = r.encode.bind(r);
    r.encode = (end: number) => { const p = enc(end); listText = readFileSync(join(framesDir, "list.txt"), "utf8"); return p; };
    vi.spyOn(Date, "now").mockReturnValue(t + 2000);
    try { await r.stop().catch(() => {}); } finally { vi.restoreAllMocks(); }
    expect(listText.split("\n").filter(Boolean)).toEqual([
      "file '0.jpg'", "duration 1.000", "file '1.jpg'", "duration 0.100", "file '2.jpg'", "duration 0.900", "file '2.jpg'",
    ]);
    expect(existsSync(framesDir)).toBe(false);
  });
  it("a failed start leaves no .frames directory", async () => {
    const dir = mkdtempSync(join(out, "fs-"));
    await new Recorder().start({ url: "http://127.0.0.1:1/", dir }).catch(() => {});
    expect(readdirSync(dir).filter((f) => f.endsWith(".frames"))).toEqual([]);
  });
});

describe("Recorder start failures (no ffmpeg needed)", () => {
  const withChromium = async (path: string | undefined, f: () => Promise<void>) => {
    const old = process.env.SHIPVO_CHROMIUM;
    if (path === undefined) delete process.env.SHIPVO_CHROMIUM; else process.env.SHIPVO_CHROMIUM = path;
    try { await f(); } finally { if (old === undefined) delete process.env.SHIPVO_CHROMIUM; else process.env.SHIPVO_CHROMIUM = old; }
  };
  it("a missing Chromium gives recorder_unavailable", async () => {
    await withChromium(join(out, "no-such-chromium"), async () => {
      const r = new Recorder();
      await expect(r.start({ url, dir: out })).rejects.toMatchObject({ code: "recorder_unavailable", message: expect.stringContaining("playwright install chromium") });
      expect(r.active).toBe(false);
    });
  }, 60000);
  it("an unreachable page gives frame_unreachable with the URL", async () => {
    const chromium = process.env.SHIPVO_CHROMIUM ?? (await import("playwright")).chromium.executablePath();
    if (!existsSync(chromium)) {
      if (required) throw new Error("SHIPVO_REQUIRE_FFMPEG=1 but Chromium is missing");
      return; // no browser on this machine; the launch test above covers that path
    }
    await withChromium(chromium, async () => {
      const r = new Recorder(); const bad = "http://127.0.0.1:1/";
      await expect(r.start({ url: bad, dir: out })).rejects.toMatchObject({ code: "frame_unreachable", message: expect.stringContaining(bad) });
      expect(r.active).toBe(false);
    });
  }, 60000);
  it("stop and marker during start return no_recording", async () => {
    await withChromium(join(out, "no-such-chromium"), async () => {
      const r = new Recorder();
      const started = r.start({ url, dir: out }).catch((e) => e);
      expect(() => r.marker("x")).toThrow(expect.objectContaining({ code: "no_recording" }));
      await expect(r.stop()).rejects.toMatchObject({ code: "no_recording" });
      expect(await started).toBeInstanceOf(RecorderError);
    });
  }, 60000);
});

describe("MCP tools", () => {
  async function connect(extra: Record<string, string> = {}) {
    const env = { ...(process.env as Record<string, string>), ...extra, PN_SIM: "http://127.0.0.1:1", PN_CONTROL: "http://127.0.0.1:1" };
    const c = new Client({ name: "test", version: "0" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(dist, "server.js")], env, cwd: out }));
    return c;
  }
  it("lists the three tools with their schemas", async () => {
    const c = await connect();
    const tools = (await c.listTools()).tools.filter((t) => t.name.startsWith("record_")).sort((a, b) => a.name.localeCompare(b.name));
    expect(tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema }))).toMatchSnapshot();
    await c.close();
  });
  it.each([["record_stop", {}], ["record_marker", { caption: "x" }]])("%s without record_start returns a typed error", async (name, args) => {
    const c = await connect();
    const r: any = await c.callTool({ name, arguments: args });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.code).toBe("no_recording");
    expect(r.structuredContent.error).toMatch(/record_start/);
    await c.close();
  });
  it.skipIf(!encodeOk)("records a scripted session end to end", async () => {
    const c2 = await connect({ SHIPVO_FRAME_URL: url });
    await c2.callTool({ name: "record_start", arguments: { format: "1:1", title: "e2e" } });
    await sleep(400); await c2.callTool({ name: "record_marker", arguments: { caption: "hello" } }); await sleep(400);
    const r: any = await c2.callTool({ name: "record_stop", arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.file).toContain(join(".shipvo", "recordings"));
    expect(probe(r.structuredContent.file)).toMatchObject({ width: 1080, height: 1080 });
    expect(r.structuredContent.chapters).toEqual([{ t: expect.any(Number), caption: "hello" }]);
    await c2.close();
  }, 60000);
});
