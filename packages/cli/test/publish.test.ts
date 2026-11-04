import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const puts: string[] = [];
const values = new Map<string, string>();
const stub = {
  get: async (k: string) => values.get(k) ?? null,
  getBytes: async () => null,
  keys: async () => [] as string[],
  put: async (k: string, body: unknown) => { puts.push(k); values.set(k, typeof body === "string" ? body : ""); },
};
vi.mock("../src/config.js", async (orig) => ({
  ...(await orig<typeof import("../src/config.js")>()),
  loadConfig: () => ({ appId: "demo", name: "demo", shellMajor: 1, controlPlane: "http://x", publicKey: "k" }),
  seed: () => Buffer.alloc(32, 7).toString("base64"),
  kv: () => stub,
}));
import { publish } from "../src/publish";

const fakeHbc = (version: number) => {
  const b = new Uint8Array(64);
  b.set([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f], 0);
  new DataView(b.buffer).setUint32(8, version, true);
  return b;
};

let cwd: string, prev: string;
beforeEach(() => {
  puts.length = 0; values.clear();
  prev = process.cwd(); cwd = mkdtempSync(join(tmpdir(), "shipvo-pub-"));
  writeFileSync(join(cwd, "app.json"), JSON.stringify({ expo: { version: "1.0.0" } }));
  mkdirSync(join(cwd, "dist-ota/_expo/static/js/android"), { recursive: true });
  process.chdir(cwd);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { process.chdir(prev); vi.restoreAllMocks(); });

const withBundle = (v: number) => writeFileSync(join(cwd, "dist-ota/_expo/static/js/android/index.hbc"), fakeHbc(v));
const flags = ["--skip-export", "true", "--skip-web", "true", "--bands", "b0"];

describe("publish and the Hermes bytecode check", () => {
  it("throws on a version mismatch before any upload", async () => {
    withBundle(98);
    await expect(publish([...flags, "--hermes-bytecode-version", "96"])).rejects.toThrow(/version 98/);
    expect(puts).toEqual([]);
  });

  it("records hermes_bytecode_version in the history entry", async () => {
    withBundle(96);
    await publish([...flags, "--hermes-bytecode-version", "96"]);
    expect(JSON.parse(values.get("h/demo/r1")!).hermes_bytecode_version).toBe(96);
    expect(JSON.parse(JSON.parse(values.get("p/demo/1/b0")!).body).hermes_bytecode_version).toBe(96);
  });

  it("gives a helpful error when the flag has no value", async () => {
    withBundle(96);
    await expect(publish([...flags, "--hermes-bytecode-version"])).rejects.toThrow(/pass a value like 96/);
    expect(puts).toEqual([]);
  });
});
