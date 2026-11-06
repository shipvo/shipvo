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

test("shipvo works when the install path has a space", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "shipvo bin "));
  const cli = join(root, "node_modules", "@shipvo", "cli");
  mkdirSync(join(root, "node_modules", "shipvo", "bin"), { recursive: true });
  mkdirSync(join(cli, "dist"), { recursive: true });
  writeFileSync(join(cli, "package.json"), JSON.stringify({ name: "@shipvo/cli", version: "0.0.0", bin: { shipvo: "dist/cli.js" } }));
  writeFileSync(join(cli, "dist", "cli.js"), 'console.log("cli ran");\n');
  const copy = join(root, "node_modules", "shipvo", "bin", "shipvo.js");
  copyFileSync(bin, copy);
  const r = spawnSync(process.execPath, [copy], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /cli ran/);
});
