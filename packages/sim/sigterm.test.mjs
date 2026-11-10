// SIGTERM stops the sim server and frees its port.
import { pickPort } from "./test-port.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = pickPort(12800, 100);

test("SIGTERM exits the server and frees the port", async () => {
  const root = mkdtempSync(join(tmpdir(), "sim-term-"));
  const dist = join(root, "dist");
  mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), "<!doctype html><title>x</title>");
  const proc = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(PORT), "--dir", join(root, "state"), "--dist", dist], { stdio: "ignore", cwd: here });
  const exited = new Promise((r) => proc.once("exit", (code, sig) => r({ code, sig })));
  try {
    let up = false;
    for (let i = 0; i < 150 && !up; i++) { try { await fetch(`http://localhost:${PORT}/app/`); up = true; } catch { if (proc.exitCode !== null) throw new Error("sim exited early"); await new Promise((r) => setTimeout(r, 200)); } }
    assert.ok(up, "sim did not start");
    proc.kill("SIGTERM");
    const r = await Promise.race([exited, new Promise((res) => setTimeout(() => res(null), 15000))]);
    assert.ok(r, "server still running after SIGTERM");
    assert.equal(r.code, 0);
    await assert.rejects(fetch(`http://localhost:${PORT}/app/`));
  } finally {
    if (proc.exitCode === null) proc.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  }
});
