import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publish } from "../src/publish";

const SEED = Buffer.alloc(32, 7).toString("base64");

/** An app dir with a plain-JS bundle, as `expo export` would leave it. */
function appDir(hermesBytecodeVersion: number) {
  const dir = mkdtempSync(join(tmpdir(), "shipvo-pub-"));
  writeFileSync(join(dir, "shipvo.json"), JSON.stringify({ appId: "t", controlPlane: "https://cp.test", publicKey: "x", hermesBytecodeVersion }));
  writeFileSync(join(dir, "app.json"), JSON.stringify({ expo: { version: "1.0.0" } }));
  const js = join(dir, "dist-ota/_expo/static/js/android");
  mkdirSync(js, { recursive: true });
  writeFileSync(join(js, "index.js"), "var a=1;");
  return dir;
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("publish with a Hermes mismatch", () => {
  it("throws before any upload", async () => {
    const puts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: { method?: string }) => {
      if (init?.method === "PUT") puts.push(String(u));
      return new Response("", { status: 404 });
    }));
    vi.stubEnv("SHIPVO_SIGNING_SEED", SEED);
    vi.stubEnv("SHIPVO_PUBLISH_TOKEN", "tok");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    const prev = process.cwd();
    process.chdir(appDir(98));
    try {
      await expect(publish(["--skip-export", "true"])).rejects.toThrow(/plain JavaScript/);
    } finally { process.chdir(prev); }
    expect(puts).toEqual([]);
  });
});
