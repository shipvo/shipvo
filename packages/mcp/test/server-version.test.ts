import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("serverInfo.version", () => {
  it("is the package version", () => {
    const out = mkdtempSync(join(root, "dist-test-"));
    try {
      const b = spawnSync(process.execPath, [createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"), "-p", root, "--outDir", out], { encoding: "utf8" });
      expect(b.status, b.stdout + b.stderr).toBe(0);
      // dist-test-* sits next to package.json, so ../package.json resolves the same way as dist/.
      const init = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}\n';
      const r = spawnSync(process.execPath, [join(out, "server.js")], { input: init, encoding: "utf8", timeout: 20000, env: { ...process.env, PN_SIM: "http://localhost:1" } });
      const line = r.stdout.split("\n").find((l) => l.includes("serverInfo"))!;
      expect(JSON.parse(line).result.serverInfo.version).toBe(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
    } finally { rmSync(out, { recursive: true, force: true }); }
  }, 60000);
});
