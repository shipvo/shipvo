import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

test("server jsonl lines have time/path/bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "shipvo-srv-"));
  const logFile = join(root, "server.log");
  const jsonl = join(root, "server.log.jsonl");
  const port = 8123;
  const proc = spawn("node", [join(process.cwd(), "scripts/ios-e2e/server.mjs"), root, String(port), logFile], { stdio: "ignore" });
  await sleep(500);
  await fetch(`http://127.0.0.1:${port}/missing`);
  await fetch(`http://127.0.0.1:${port}/`, { method: "POST", body: "{}" });
  // create a file for 200
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(root, "ok.txt"), "hi");
  await fetch(`http://127.0.0.1:${port}/ok.txt`);
  await sleep(200);
  proc.kill();
  const lines = readFileSync(jsonl, "utf8").trim().split("\n").filter(Boolean);
  assert.ok(lines.length >= 3);
  for (const line of lines) {
    const obj = JSON.parse(line);
    assert.equal(typeof obj.time, "number");
    assert.equal(typeof obj.path, "string");
    assert.equal(typeof obj.bytes, "number");
  }
  rmSync(root, { recursive: true, force: true });
});
