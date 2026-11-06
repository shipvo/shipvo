import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const bin = fileURLToPath(new URL("../bin/create-shipvo.js", import.meta.url));
test("create-shipvo runs shipvo init", () => {
  const cwd = mkdtempSync(join(tmpdir(), "create-shipvo-"));
  const r = spawnSync(process.execPath, [bin, "demoapp"], { cwd, encoding: "utf8", env: { ...process.env, CI: "1" } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(cwd, "demoapp", "package.json")));
});

test("imports the cli by its file URL, not by a pathname (C:/C:/... on Windows, #573)", async () => {
  const src = (await import("node:fs")).readFileSync(fileURLToPath(new URL("../bin/create-shipvo.js", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /\.pathname/);
  assert.match(src, /await import\(new URL\(bin, pathToFileURL\(pkg\)\)\.href\)/);
});
