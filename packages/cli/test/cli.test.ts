import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { b64, keyFromSeed } from "../src/index";
import { suggest } from "../src/help";

const root = resolve(__dirname, "..");
let out = "";
const run = (...args: string[]) => spawnSync(process.execPath, [join(out, "cli.js"), ...args], { encoding: "utf8" });

beforeAll(() => {
  out = mkdtempSync(join(root, "dist-test-"));
  const tsc = createRequire(join(root, "package.json")).resolve("typescript/bin/tsc");
  const r = spawnSync(process.execPath, [tsc, "-p", join(root, "tsconfig.json"), "--outDir", out], { encoding: "utf8" });
  expect(r.status, r.stdout + r.stderr).toBe(0);
}, 60_000);

afterAll(() => { if (out) rmSync(out, { recursive: true, force: true }); });

describe("cli", () => {
  it("prints the package version for --version and -v, and an envelope with --json", () => {
    const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
    for (const flag of ["--version", "-v"]) {
      const r = run(flag);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(version);
    }
    const j = run("--version", "--json");
    expect(j.status).toBe(0);
    const doc = JSON.parse(j.stdout);
    expect(doc.ok).toBe(true);
    expect(doc.data.version).toBe(version);
    expect(run("--help").stdout).toContain("--version");
  });

  it("names an unknown command and suggests the closest one", () => {
    const r = run("publsh");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("shipvo: 'publsh' is not a command. Did you mean 'publish'?");
    expect(r.stderr).toContain("Run 'shipvo --help' to see all commands.");
    expect(r.stdout).toBe("");
  });

  it("explains a missing shipvo.json in plain words, with no stack trace", () => {
    const dir = mkdtempSync(join(tmpdir(), "shipvo-empty-"));
    try {
      const r = spawnSync(process.execPath, [join(out, "cli.js"), "publish"], { encoding: "utf8", cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("shipvo: No shipvo.json in this folder.");
      expect(r.stderr).toContain("shipvo init myshop");
      expect(r.stderr).not.toContain("    at ");
      const d = spawnSync(process.execPath, [join(out, "cli.js"), "publish"], { encoding: "utf8", cwd: dir, env: { ...process.env, SHIPVO_DEBUG: "1" } });
      expect(d.stderr).toContain("    at ");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("prints the local MCP config when not signed in", () => {
    const home = mkdtempSync(join(tmpdir(), "shipvo-home-"));
    try {
      const r = spawnSync(process.execPath, [join(out, "cli.js"), "mcp"], { encoding: "utf8", env: { ...process.env, SHIPVO_HOME: home } });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('"args": [\n        "-y",\n        "@shipvo/mcp"');
      expect(r.stderr).not.toContain("Not signed in");
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it("does not suggest when nothing is close", () => {
    const r = run("zzzzzzzz");
    expect(r.status).toBe(1);
    expect(r.stderr).not.toContain("Did you mean");
    expect(r.stdout).toBe("");
  });

  it("shows grouped help for --help and for no command", () => {
    for (const args of [["--help"], []]) {
      const r = run(...args);
      expect(r.status).toBe(0);
      for (const h of ["Start", "Ship", "Advanced"]) expect(r.stdout).toContain(`\n${h}\n`);
      expect(r.stdout).toContain("sim --watch");
      expect(r.stdout).toContain("status [--app id] [--json]");
    }
  });
});

describe("verify", () => {
  const seed = Buffer.alloc(32, 9).toString("base64");
  const pub = b64(keyFromSeed(seed).publicKey);
  let dir = "";
  const sh = (...args: string[]) => spawnSync(process.execPath, [join(out, "cli.js"), ...args], { encoding: "utf8", cwd: dir, env: { ...process.env, SHIPVO_SIGNING_SEED: seed, SHIPVO_HOME: dir } });

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "shipvo-verify-"));
    writeFileSync(join(dir, "app.json"), JSON.stringify({ expo: { version: "1.0.0" } }));
    writeFileSync(join(dir, "shipvo.json"), JSON.stringify({ appId: "demo", controlPlane: "http://x", publicKey: pub }));
    mkdirSync(join(dir, "dist-ota/_expo/static/js/android"), { recursive: true });
    const hbc = new Uint8Array(64);
    hbc.set([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f], 0);
    writeFileSync(join(dir, "dist-ota/_expo/static/js/android/index.hbc"), hbc);
    const r = sh("publish", "--dry-run", "--skip-export", "true", "--skip-web", "true", "--bands", "b0");
    expect(r.status, r.stdout + r.stderr).toBe(0);
  }, 60_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  const ptr = () => join(dir, ".shipvo/dry-run/p/demo/1/b0");

  it("accepts a real publish --dry-run pointer with the seed's key", () => {
    const r = sh("verify", ptr());
    expect(r.stdout.trim()).toBe("valid");
    expect(r.status).toBe(0);
    expect(sh("verify", ptr(), pub).status).toBe(0);
  });

  it("rejects a pointer whose body changed by one byte", () => {
    const p = JSON.parse(readFileSync(ptr(), "utf8"));
    p.body = p.body.replace('"release":1', '"release":2');
    expect(p.body).not.toBe(JSON.parse(readFileSync(ptr(), "utf8")).body);
    const bad = join(dir, "bad-pointer");
    writeFileSync(bad, JSON.stringify(p));
    const r = sh("verify", bad);
    expect(r.stdout.trim()).toBe("INVALID");
    expect(r.status).toBe(1);
  });

  it("exits 2 with a usage line when no file is given", () => {
    const r = sh("verify");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Usage: shipvo verify");
  });

  it("exits 2 with a one-line message for a missing file or a directory", () => {
    for (const p of [join(dir, "nope"), dir]) {
      const r = sh("verify", p);
      expect(r.status).toBe(2);
      expect(r.stderr.trim()).toBe(`Cannot read ${p}`);
    }
  });
});

describe("suggest", () => {
  it("uses edit distance 2 or less", () => {
    expect(suggest("sing-json")).toBe("sign-json");
    expect(suggest("roll")).toBeUndefined();
  });
});
