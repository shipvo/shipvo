import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
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

test("without --with-install, no install step", () => {
  const f = fake(`import {mkdirSync} from "node:fs"; if (process.argv[2]==="init") mkdirSync(process.argv[3],{recursive:true});`);
  const r = run(f);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(readFileSync(f.out, "utf8"));
  assert.deepEqual(j.map((x) => x.step), ["init", "publish --dry-run"]);
  assert.doesNotMatch(r.stdout, /\| install \|/);
  assert.doesNotMatch(r.stdout, /package manager:/);
});

test("with --with-install, install step is included", () => {
  const bindir = mkdtempSync(join(tmpdir(), "fake-pnpm-"));
  const pnpm = join(bindir, "pnpm");
  writeFileSync(pnpm, "#!/bin/sh\necho 9.9.9\nexit 0\n");
  chmodSync(pnpm, 0o755);
  const f = fake(`import {mkdirSync} from "node:fs"; if (process.argv[2]==="init") mkdirSync(process.argv[3],{recursive:true});`);
  const r = spawnSync(process.execPath, [script, "--cli", f.cli, "--out", f.out, "--with-install"], {
    encoding: "utf8",
    env: { ...process.env, PATH: bindir + ":" + process.env.PATH },
  });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(readFileSync(f.out, "utf8"));
  assert.deepEqual(j.map((x) => x.step), ["init", "install", "publish --dry-run"]);
  assert.match(r.stdout, /\| install \|/);
  assert.match(r.stdout, /package manager: pnpm 9\.9\.9/);
});

test("a failing install stops the run and shows its stderr", () => {
  const bindir = mkdtempSync(join(tmpdir(), "fake-pnpm-"));
  const pnpm = join(bindir, "pnpm");
  writeFileSync(pnpm, "#!/bin/sh\necho boom: install failed >&2\nexit 1\n");
  chmodSync(pnpm, 0o755);
  const f = fake(`import {mkdirSync} from "node:fs"; if (process.argv[2]==="init") mkdirSync(process.argv[3],{recursive:true});`);
  const r = spawnSync(process.execPath, [script, "--cli", f.cli, "--out", f.out, "--with-install"], {
    encoding: "utf8",
    env: { ...process.env, PATH: bindir + ":" + process.env.PATH },
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /boom: install failed/);
  const j = JSON.parse(readFileSync(f.out, "utf8"));
  assert.deepEqual(j.map((x) => x.step), ["init", "install"]);
});
