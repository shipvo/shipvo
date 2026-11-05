// record_start / record_marker / record_stop end to end, in CI without ffmpeg: a stub script stands in for ffmpeg
// and a fake simulator answers screenshots.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(__dirname, "..");
let out = "", work = "", simServer: http.Server, c: Client;
const failFlag = () => join(work, "fail"), argsLog = () => join(work, "args.jsonl");

const STUB = `#!/usr/bin/env node
const fs = require("fs");
const a = process.argv.slice(2);
if (fs.existsSync(process.env.STUB_FAIL)) { process.stderr.write("stub: forced failure"); process.exit(1); }
if (a.includes("pipe:1")) { // decode one screenshot to raw RGBA
  const m = /scale=(\\d+):(\\d+)/.exec(a.join(" "));
  process.stdout.write(Buffer.alloc(Number(m[1]) * Number(m[2]) * 4));
} else {
  let n = 0;
  process.stdin.on("data", (d) => { n += d.length; });
  process.stdin.on("end", () => {
    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ args: a, bytes: n }) + "\\n");
    fs.writeFileSync(a[a.length - 1], "stub-video");
  });
  process.stdin.resume();
}
`;

beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  work = mkdtempSync(join(tmpdir(), "rec-stop-"));
  const stub = join(work, "ffmpeg-stub.js"); writeFileSync(stub, STUB); chmodSync(stub, 0o755);
  simServer = http.createServer((req, res) => { req.resume(); req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, data: Buffer.from("fake-jpeg").toString("base64") })); }); });
  await new Promise<void>((r) => simServer.listen(0, "127.0.0.1", r));
  c = new Client({ name: "test", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env: {
    ...(process.env as Record<string, string>), PN_SIM: `http://127.0.0.1:${(simServer.address() as AddressInfo).port}`,
    SHIPVO_FFMPEG: stub, STUB_FAIL: failFlag(), STUB_LOG: argsLog(), PN_RECORD_DIR: join(work, "rec"),
  } }));
});
afterAll(async () => { await c?.close(); simServer?.close(); if (out) rmSync(out, { recursive: true, force: true }); if (work) rmSync(work, { recursive: true, force: true }); });

const call = (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;

describe("record_stop", () => {
  it("keeps the recording when encoding fails, so a retry works with the same frames", async () => {
    await call("record_start", { session: "retry", fps: 30 });
    await call("record_marker", { session: "retry", caption: "Open the shop" });
    writeFileSync(failFlag(), "1");
    const bad = await call("record_stop", { session: "retry" });
    expect(bad.isError).toBe(true);
    expect(bad.structuredContent.code).not.toBe("not_recording");
    rmSync(failFlag());
    const ok = await call("record_stop", { session: "retry" });
    expect(ok.isError).toBeFalsy();
    expect(ok.structuredContent.chapters).toEqual([{ t: expect.any(Number), caption: "Open the shop" }]);
    expect(existsSync(ok.structuredContent.file)).toBe(true);
    const again = await call("record_stop", { session: "retry" });
    expect(again.structuredContent.code).toBe("not_recording"); // deleted only after success
  });

  it("pipes frames to ffmpeg with the expected arguments", async () => {
    await call("record_start", { session: "args", format: "16:9", fps: 30 });
    const r = await call("record_stop", { session: "args" });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ width: 1920, height: 1080 });
    const last = JSON.parse(readFileSync(argsLog(), "utf8").trim().split("\n").at(-1)!);
    const a: string[] = last.args;
    expect(a[a.indexOf("-s") + 1]).toBe("1920x1080");
    expect(a[a.indexOf("-r") + 1]).toBe("30");
    expect(a[a.indexOf("-preset") + 1]).toBe("veryfast");
    expect(a[a.indexOf("-movflags") + 1]).toBe("+faststart");
    const frames = Math.round(r.structuredContent.duration_s * 30);
    expect(last.bytes / (1920 * 1080 * 4)).toBeGreaterThanOrEqual(frames - 3);
    expect(last.bytes % (1920 * 1080 * 4)).toBe(0);
  });

  it("rejects a narration file that is missing or not a .wav, and keeps the recording", async () => {
    await call("record_start", { session: "nar" });
    const missing = await call("record_stop", { session: "nar", narration: join(work, "nope.wav") });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent.code).toBe("narration_not_found");
    expect(missing.structuredContent.error).toMatch(/no file at/);
    const notWav = await call("record_stop", { session: "nar", narration: join(work, "ffmpeg-stub.js") });
    expect(notWav.structuredContent.code).toBe("narration_not_wav");
    const ok = await call("record_stop", { session: "nar" });
    expect(ok.isError).toBeFalsy();
  });
});
