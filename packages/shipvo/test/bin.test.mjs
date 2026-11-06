import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const bin = fileURLToPath(new URL("../bin/shipvo.js", import.meta.url));
test("shipvo runs @shipvo/cli (help lists init)", () => {
  const r = spawnSync(process.execPath, [bin, "help"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout + r.stderr, /init/);
});
