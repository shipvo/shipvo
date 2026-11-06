import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { workspacePackages, packClosure, findTarballs, stepList, jsonLine, withOverrides, commandLine, APP_NAME } from "./cross-os.mjs";

const files = ["shipvo-cli-0.1.0.tgz", "shipvo-0.1.0.tgz", "create-shipvo-0.1.0.tgz", "other.txt"];

test("findTarballs picks each package and builds paths with join", () => {
  const dir = join("tmp dir", "with space");
  const t = findTarballs(dir, files);
  assert.equal(t.cli, join(dir, "shipvo-cli-0.1.0.tgz"));
  assert.equal(t.shipvo, join(dir, "shipvo-0.1.0.tgz"));
  assert.equal(t.create, join(dir, "create-shipvo-0.1.0.tgz"));
});

test("findTarballs names the missing package", () => {
  assert.throws(() => findTarballs("d", ["shipvo-0.1.0.tgz"]), /no tarball for cli/);
});

test("findTarballs reads a real directory whose name has a space", () => {
  const d = mkdtempSync(join(tmpdir(), "cross os "));
  try {
    for (const f of files) writeFileSync(join(d, f), "");
    assert.equal(findTarballs(d).cli, join(d, "shipvo-cli-0.1.0.tgz"));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("step list is the four-step path in order", () => {
  const steps = stepList(findTarballs("x", files));
  assert.deepEqual(steps.map((s) => s.name), ["npm create shipvo", "npm install", "shipvo doctor --json", "shipvo publish --dry-run"]);
  assert.deepEqual(steps[0].args, ["exec", "--yes", ...["create-shipvo-0.1.0", "shipvo-cli-0.1.0", "shipvo-0.1.0"].map((n) => `--package=${join("x", n + ".tgz")}`), "--", "create-shipvo", APP_NAME]);
  assert.deepEqual(stepList()[0].args, ["create", "shipvo", APP_NAME]);
  assert.ok(steps[2].args.includes("--json"));
  assert.ok(steps[3].args.includes("--dry-run"));
});

test("jsonLine has step, exit and rounded ms", () => {
  assert.deepEqual(JSON.parse(jsonLine("npm install", 0, 12.6)), { step: "npm install", exit: 0, ms: 13 });
});

test("withOverrides points both packages at the tarballs and keeps other fields", () => {
  const t = findTarballs(join("a b", "c"), files);
  const out = withOverrides({ name: "x", overrides: { y: "1" } }, t);
  assert.equal(out.name, "x");
  assert.equal(out.overrides.y, "1");
  assert.match(out.devDependencies["@shipvo/cli"], /^file:\/\/.*shipvo-cli-0\.1\.0\.tgz$/);
  assert.match(out.devDependencies.shipvo, /^file:\/\/.*shipvo-0\.1\.0\.tgz$/);
  assert.ok(out.devDependencies.shipvo.includes("a%20b"));
  assert.equal(out.overrides["@shipvo/cli"], "$@shipvo/cli");
});

test("commandLine quotes spaces for a Windows shell and not elsewhere", () => {
  const args = ["create", join("my dir", "a.tgz"), "myshop"];
  assert.deepEqual(commandLine("npm", args, "linux"), { cmd: "npm", args, shell: false });
  const w = commandLine("npm", args, "win32");
  assert.equal(w.shell, true);
  assert.equal(w.cmd, `npm create "${join("my dir", "a.tgz")}" myshop`);
});

test("dependency walk packs the CLI's @shipvo deps transitively", () => {
  const root = mkdtempSync(join(tmpdir(), "ws "));
  try {
    const add = (dir, name, deps) => {
      mkdirSync(join(root, "packages", dir), { recursive: true });
      writeFileSync(join(root, "packages", dir, "package.json"), JSON.stringify({ name, dependencies: Object.fromEntries(deps.map((d) => [d, "workspace:^"])) }));
    };
    add("cli", "@shipvo/cli", ["@shipvo/sim", "@shipvo/store"]);
    add("sim", "@shipvo/sim", ["@shipvo/schema"]);
    add("store", "@shipvo/store", []);
    add("schema", "@shipvo/schema", []);
    add("unused", "@shipvo/unused", []);
    add("shipvo", "shipvo", ["@shipvo/cli"]);
    add("create-shipvo", "create-shipvo", ["@shipvo/cli"]);
    assert.deepEqual(packClosure(workspacePackages(root)), ["@shipvo/cli", "@shipvo/schema", "@shipvo/sim", "@shipvo/store", "create-shipvo", "shipvo"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("unpublished versions: every tarball is a --package and an override", () => {
  const f = [...files, "shipvo-sim-9.9.9.tgz", "shipvo-store-9.9.9.tgz", "shipvo-schema-9.9.9.tgz"];
  const t = findTarballs("d", f);
  assert.equal(t.all["@shipvo/sim"], join("d", "shipvo-sim-9.9.9.tgz"));
  const args = stepList(t)[0].args;
  for (const n of ["shipvo-sim-9.9.9", "shipvo-store-9.9.9", "shipvo-schema-9.9.9", "shipvo-cli-0.1.0"]) assert.ok(args.includes(`--package=${join("d", n + ".tgz")}`), n);
  const out = withOverrides({}, t);
  assert.match(out.overrides["@shipvo/sim"], /^file:\/\/.*shipvo-sim-9\.9\.9\.tgz$/);
  assert.match(out.overrides["@shipvo/store"], /shipvo-store-9\.9\.9\.tgz$/);
  assert.equal(out.overrides["@shipvo/cli"], "$@shipvo/cli");
});
