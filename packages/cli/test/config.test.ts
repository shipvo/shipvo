import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { args, kv, loadConfig, publishToken, seed } from "../src/config.js";

const saved = { ...process.env };
const cwd = process.cwd();
const ENV = ["SHIPVO_SIGNING_SEED", "PURENATIVE_SIGNING_SEED", "SHIPVO_SIGNING_SEED_FILE", "PURENATIVE_SIGNING_SEED_FILE", "SHIPVO_PUBLISH_TOKEN", "SHIPVO_ACTOR", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "SHIPVO_KV_ID", "PURENATIVE_KV_ID"];
let dir = "";

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  dir = mkdtempSync(join(tmpdir(), "shipvo-config-"));
  process.chdir(dir);
});
afterAll(() => { process.chdir(cwd); process.env = saved; });

describe("loadConfig", () => {
  it("tells you what to do when shipvo.json is missing", () => {
    expect(() => loadConfig(dir)).toThrow(/No shipvo\.json.*shipvo init/);
  });
  it.each(["appId", "controlPlane", "publicKey"])("requires %s", (k) => {
    const c: Record<string, string> = { appId: "a", controlPlane: "https://x", publicKey: "k" };
    delete c[k];
    writeFileSync(join(dir, "shipvo.json"), JSON.stringify(c));
    expect(() => loadConfig(dir)).toThrow(new RegExp(`"${k}" is required`));
  });
  it("defaults name to appId and shellMajor to 1, and lets the file override", () => {
    writeFileSync(join(dir, "shipvo.json"), JSON.stringify({ appId: "a", controlPlane: "https://x", publicKey: "k" }));
    expect(loadConfig(dir)).toMatchObject({ name: "a", shellMajor: 1 });
    writeFileSync(join(dir, "shipvo.json"), JSON.stringify({ appId: "a", controlPlane: "https://x", publicKey: "k", name: "Shop", shellMajor: 3 }));
    expect(loadConfig(dir)).toMatchObject({ name: "Shop", shellMajor: 3 });
  });
});

describe("args", () => {
  it("reads --key value pairs and bare flags", () => {
    expect(args(["publish", "--channel", "beta", "--dry-run", "--json"])).toEqual({ channel: "beta", "dry-run": "true", json: "true" });
  });
  it("does not take the next flag as a value", () => {
    expect(args(["--a", "--b", "x"])).toEqual({ a: "true", b: "x" });
  });
  it("ignores positional words", () => {
    expect(args(["one", "two"])).toEqual({});
  });
});

describe("publishToken", () => {
  it("prefers the environment, trimmed, over the file", () => {
    mkdirSync(join(dir, ".shipvo"));
    writeFileSync(join(dir, ".shipvo", "publish-token"), "from-file\n");
    process.env.SHIPVO_PUBLISH_TOKEN = "  from-env \n";
    expect(publishToken()).toBe("from-env");
  });
  it("reads .shipvo/publish-token, and returns null when absent or empty", () => {
    expect(publishToken()).toBeNull();
    mkdirSync(join(dir, ".shipvo"));
    writeFileSync(join(dir, ".shipvo", "publish-token"), "  \n");
    expect(publishToken()).toBeNull();
    writeFileSync(join(dir, ".shipvo", "publish-token"), "tok\n");
    expect(publishToken()).toBe("tok");
  });
});

describe("seed", () => {
  it("order: env seed, legacy env seed, seed file, local file", () => {
    mkdirSync(join(dir, ".shipvo"));
    writeFileSync(join(dir, ".shipvo", "seed.txt"), "local\n");
    expect(seed()).toBe("local");
    writeFileSync(join(dir, "seed-file"), "file\n");
    process.env.SHIPVO_SIGNING_SEED_FILE = join(dir, "seed-file");
    expect(seed()).toBe("file");
    process.env.PURENATIVE_SIGNING_SEED = "legacy";
    expect(seed()).toBe("legacy");
    process.env.SHIPVO_SIGNING_SEED = "new";
    expect(seed()).toBe("new");
  });
});

describe("hosted kv server behaviour", () => {
  let server: Server, port = 0, reply: (url: string) => [number, string] = () => [200, "{}"];
  const seen: { url: string; headers: Record<string, string | string[] | undefined> }[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({ url: req.url!, headers: req.headers });
      const [status, body] = reply(req.url!);
      res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(body);
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => { server.close(); });
  beforeEach(() => { seen.length = 0; process.env.SHIPVO_PUBLISH_TOKEN = "tok"; reply = () => [200, "{}"]; });
  const cfg = () => ({ appId: "app", name: "app", shellMajor: 1, controlPlane: `http://127.0.0.1:${port}/`, publicKey: "k" });

  it("reports a typed policy refusal with the rule, not as a bad token", async () => {
    reply = () => [403, JSON.stringify({ code: "policy_refused", rule: "no-friday", reason: "No releases on Friday" })];
    await expect(kv(cfg()).put("b/x", "x", "text/plain")).rejects.toThrow(/Refused by policy rule no-friday: No releases on Friday/);
  });
  it("a 403 without a policy code is a rejected token", async () => {
    reply = () => [403, "not json"];
    await expect(kv(cfg()).get("b/x")).rejects.toThrow(/rejected your publish token \(403\)/);
  });
  it("sends the bearer token, encodes each key segment and keeps the slashes", async () => {
    await kv(cfg()).get("p/app/1 2/a?b#c");
    expect(seen[0].url).toBe("/apps/app/kv/p/app/1%202/a%3Fb%23c");
    expect(seen[0].headers.authorization).toBe("Bearer tok");
    expect(seen[0].headers["x-shipvo-actor"]).toBeUndefined();
  });
  it("marks agent actors", async () => {
    process.env.SHIPVO_ACTOR = "agent";
    await kv(cfg()).get("k");
    expect(seen[0].headers["x-shipvo-actor"]).toBe("agent");
  });
  it("get returns null for a missing key and keys lists with an encoded prefix", async () => {
    reply = (u) => (u.includes("prefix=") ? [200, JSON.stringify({ keys: ["p/a", "p/b"] })] : [404, "{}"]);
    expect(await kv(cfg()).get("nope")).toBeNull();
    expect(await kv(cfg()).keys("p/a b")).toEqual(["p/a", "p/b"]);
    expect(seen[1].url).toBe("/apps/app/kv?prefix=p%2Fa%20b");
  });
  it("put surfaces the server message on failure", async () => {
    reply = () => [409, JSON.stringify({ message: "pointer does not verify" })];
    await expect(kv(cfg()).put("p/x", "x", "text/plain")).rejects.toThrow(/publish p\/x: 409 pointer does not verify/);
  });
  it("cleans up", () => { rmSync(dir, { recursive: true, force: true }); });
});
