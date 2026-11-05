// Slice 3 of #227: a session recorded through the MCP server, exported with export_test, runs again
// with Vitest and @shipvo/test against the real simulator and the sample app. No agent is involved in the replay.
// Run with REPLAY_DEBUG=1 to print the script and the Vitest output (copied into docs/agents.md).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(__dirname, "..");
const repo = resolve(root, "../..");
const app = join(repo, "apps/tide-and-tackle");
const require_ = createRequire(join(root, "package.json"));
let out = ""; let work = ""; let sim: ChildProcess | undefined; let simErr = "";
const port = 4900 + Math.floor(Math.random() * 300);

beforeAll(async () => {
  out = mkdtempSync(join(root, "dist-test-"));
  work = mkdtempSync(join(tmpdir(), "export-replay-"));
  const b = spawnSync(process.execPath, [require_.resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
  if (b.status !== 0) throw new Error(b.stdout + b.stderr);
  // The sample app's web build, the same one CI serves to the simulator.
  const expo = spawnSync("npx", ["expo", "export", "--platform", "web", "--output-dir", join(work, "dist")], { cwd: app, encoding: "utf8", env: { ...process.env, PN_SIM: "1", CI: "1" } });
  if (expo.status !== 0) throw new Error("expo export failed:\n" + expo.stdout + expo.stderr);
  const pw = createRequire(join(repo, "packages/sim/package.json"))("playwright");
  if (!existsSync(pw.chromium.executablePath())) throw new Error("Chromium is not installed: run scripts/agents/install-chromium.sh");
  sim = spawn(process.execPath, [join(repo, "packages/sim/server.mjs"), "--port", String(port), "--dir", join(work, "state"), "--dist", join(work, "dist")], { cwd: app, stdio: ["ignore", "ignore", "pipe"] });
  sim.stderr!.on("data", (d) => { simErr += d; });
  let up = false;
  for (let i = 0; i < 450 && !up; i++) {
    try { await fetch(`http://localhost:${port}/`); up = true; } catch { if (sim.exitCode !== null) throw new Error("sim exited: " + simErr); await new Promise((r) => setTimeout(r, 200)); }
  }
  if (!up) throw new Error(`sim did not start on port ${port} within 90 s. stderr: ${simErr || "(empty)"}`);
}, 240_000);
afterAll(async () => {
  if (sim && sim.exitCode === null) { const done = new Promise((r) => sim!.once("exit", r)); sim.kill("SIGKILL"); await done; }
  sim?.stderr?.destroy();
  if (out) rmSync(out, { recursive: true, force: true });
  if (work) rmSync(work, { recursive: true, force: true });
});

const txt = (r: any) => r.content[0].text as string;

describe("export_test replay", () => {
  it("an exported script passes against the sample app", async () => {
    const env: Record<string, string> = { ...(process.env as Record<string, string>), PN_SIM: `http://localhost:${port}`, PN_CONTROL: "http://127.0.0.1:1", PN_APPS: JSON.stringify({ tide: { name: "Tide & Tackle", description: "sample app" } }) };
    const c = new Client({ name: "test", version: "0" });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(out, "server.js")], env }));
    const tap = async (ref: string) => expect((await c.callTool({ name: "tap", arguments: { session: "r1", ref } }) as any).isError).toBeFalsy();
    const opened = txt(await c.callTool({ name: "open_app", arguments: { app: "tide", session: "r1" } }));
    const ref = (s: string, name: string) => new RegExp(`"${name}"[^\\n]*\\[ref=(\\w+)\\]`).exec(s)?.[1] ?? expect.fail(`no "${name}" on screen:\n${s}`);
    await tap(ref(opened, "My orders"));
    expect(txt(await c.callTool({ name: "back", arguments: { session: "r1" } }))).toContain("Shop by department");
    const home = txt(await c.callTool({ name: "screen", arguments: { session: "r1" } }));
    await tap(ref(home, "Department Rods"));
    const script = txt(await c.callTool({ name: "export_test", arguments: { session: "r1" } }));
    await c.close();

    expect(script).toContain('await phone.tap("My orders");');
    expect(script).toContain("await phone.back();");
    expect(script).toContain('await phone.tap("Department Rods");');

    // Run it the way CI would: a file on disk, Vitest, @shipvo/test, the simulator. No MCP, no agent.
    const dir = mkdtempSync(join(root, "replay-"));
    try {
      const file = join(dir, "recorded.replay.ts");
      writeFileSync(file, script);
      const cfg = join(dir, "vitest.config.mts");
      const src = (f: string) => resolve(repo, "packages/test/src", f);
      writeFileSync(cfg, `import { defineConfig } from "vitest/config";
export default defineConfig({ root: ${JSON.stringify(dir)}, resolve: { alias: [{ find: "@shipvo/test/vitest", replacement: ${JSON.stringify(src("vitest.ts"))} }, { find: /^@shipvo\\/test$/, replacement: ${JSON.stringify(src("index.ts"))} }] }, test: { include: ["*.replay.ts"], testTimeout: 60000 } });
`);
      const run = spawnSync(process.execPath, [require_.resolve("vitest/vitest.mjs"), "run", "--config", cfg, "--reporter", "verbose"], { cwd: dir, encoding: "utf8", env: { ...process.env, PN_SIM: `http://localhost:${port}`, NO_COLOR: "1", FORCE_COLOR: "0" } });
      const log = run.stdout + run.stderr;
      if (process.env.REPLAY_DEBUG) console.log("--- exported script ---\n" + script + "--- vitest output ---\n" + log);
      expect(log).toContain("1 passed");
      expect(run.status, log).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
});
