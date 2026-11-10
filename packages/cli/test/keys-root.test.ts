import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signingKey } from "../src/signing";
import { b64, keyFromSeed } from "../src/index";

const cwd = process.cwd();
afterEach(() => { process.chdir(cwd); vi.restoreAllMocks(); });
function inApp() {
  const d = mkdtempSync(join(tmpdir(), "shipvo-root-"));
  writeFileSync(join(d, "shipvo.json"), JSON.stringify({ appId: "shop", controlPlane: "https://cp.test/", publicKey: "k" }));
  process.chdir(d);
  return d;
}

describe("shipvo keys root", () => {
  it("writes a 0600 root seed and prints only the public key", async () => {
    const d = inApp();
    const out = join(d, "root.txt");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await signingKey(["root", "--out", out]);
    const seed = readFileSync(out, "utf8").trim();
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(String(log.mock.calls[0][0])).toContain(b64(keyFromSeed(seed).publicKey));
    expect(String(log.mock.calls[0][0])).not.toContain(seed);
  });
  it("refuses to overwrite an existing root seed", async () => {
    const d = inApp();
    const out = join(d, "root.txt");
    writeFileSync(out, "keep\n");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error("exit " + c); }) as any);
    await expect(signingKey(["root", "--out", out])).rejects.toThrow("exit 1");
    expect(readFileSync(out, "utf8")).toBe("keep\n");
  });
  it("exits 2 when --out has no value", async () => {
    inApp();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error("exit " + c); }) as any);
    await expect(signingKey(["root", "--out"])).rejects.toThrow("exit 2");
    expect(String(err.mock.calls[0][0])).toContain("Usage: shipvo keys root --out");
  });
});
