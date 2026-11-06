import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promote } from "../src/promote";
import { rollback } from "../src/publish";

const ENV = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "SHIPVO_KV_ID", "PURENATIVE_KV_ID", "SHIPVO_PUBLISH_TOKEN", "SHIPVO_SIGNING_SEED", "PURENATIVE_SIGNING_SEED", "SHIPVO_SIGNING_SEED_FILE"];
let prev: string, logs: string[], saved: Record<string, string | undefined>;
const w = (f: string, c: string) => { mkdirSync(join(f, ".."), { recursive: true }); writeFileSync(f, c); };

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]])); ENV.forEach((k) => delete process.env[k]);
  logs = []; prev = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "shipvo-offline-")); process.chdir(dir);
  w("shipvo.json", JSON.stringify({ appId: "demo", name: "demo", shellMajor: 1, controlPlane: "http://127.0.0.1:1", publicKey: "k" }));
  const body = JSON.stringify({ app_id: "demo", band: "b0", release: 2, core: { sha256: "abc", size: 3 }, min_shell_version: "1.0.0" });
  w(".shipvo/dry-run/p/demo/1/b0", JSON.stringify({ body, signature: "s" }));
  w(".shipvo/dry-run/b/demo/r1.hbc", "abc");
  vi.spyOn(console, "log").mockImplementation((m: string) => { logs.push(String(m)); });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { process.chdir(prev); vi.restoreAllMocks(); ENV.forEach((k) => { if (saved[k] !== undefined) process.env[k] = saved[k]; }); });

describe("offline dry run", () => {
  it("promote --dry-run reads .shipvo/dry-run with no login and writes nothing", async () => {
    await promote(["--dry-run"]);
    expect(logs.join("\n")).toContain("Would write b1 (android): release 2");
    expect(readdirSync(".shipvo/dry-run/p/demo/1")).toEqual(["b0"]);
  });
  it("rollback --to --dry-run previews with no login and no signing key", async () => {
    await rollback(["--to", "1", "--dry-run"]);
    expect(logs.join("\n")).toContain("New release number: 3");
    expect(readdirSync(".shipvo/dry-run/p/demo/1")).toEqual(["b0"]);
  });
});
