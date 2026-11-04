import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { table } from "./measure.mjs";

const script = fileURLToPath(new URL("./measure.mjs", import.meta.url));
const fake = (body) => {
  const d = mkdtempSync(join(tmpdir(), "fake-cli-"));
  const f = join(d, "cli.js");
  writeFileSync(f, body);
  return { cli: f, out: join(d, "first-run.json") };
};
const run = ({ cli, out }) => spawnSync(process.execPath, [script, "--cli", cli, "--out", out], { encoding: "utf8" });

test("passes when every step exits 0, writes json and a table", () => {
  const f = fake(`import {mkdirSync} from "node:fs"; if (process.argv[2]==="init") mkdirSync(process.argv[3],{recursive:true});`);
  const r = run(f);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(readFileSync(f.out, "utf8"));
  assert.deepEqual(j.map((x) => [x.step, x.exit]), [["init", 0], ["publish --dry-run", 0]]);
  assert.ok(j.every((x) => Number.isInteger(x.ms)));
  assert.match(r.stdout, /\| init \| \d+ \| 0 \|/);
});

test("a failing step exits non-zero and shows its stderr", () => {
  const f = fake(`import {mkdirSync} from "node:fs"; if (process.argv[2]==="init") mkdirSync(process.argv[3],{recursive:true}); else { console.error("boom: no seed"); process.exit(3); }`);
  const r = run(f);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /boom: no seed/);
  assert.equal(JSON.parse(readFileSync(f.out, "utf8"))[1].exit, 3);
});

test("a failing init stops the run", () => {
  const f = fake(`console.error("init broke"); process.exit(1);`);
  const r = run(f);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /init broke/);
  assert.equal(JSON.parse(readFileSync(f.out, "utf8")).length, 1);
});

test("table renders rows", () => {
  assert.equal(table([{ step: "a", ms: 5, exit: 0 }]).split("\n")[2], "| a | 5 | 0 |");
});
