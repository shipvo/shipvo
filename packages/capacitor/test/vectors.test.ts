import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ShipvoCapacitor, MemoryFiles, MemoryStore } from "../src/index.js";

// The iOS Swift tests read the same file (ios/Tests/ShipvoBundleTests).
// Each vector goes through the real engine: a fake server returns the signed pointer and the archive.
const V = JSON.parse(readFileSync(new URL("../test-vectors/bundle.json", import.meta.url), "utf8"));
type Case = { name: string; body: string; signature: string; archive: string; expect: string };

describe("shared bundle vectors", () => {
  for (const c of V.cases as Case[]) {
    it(c.name, async () => {
      const bytes = new Uint8Array(Buffer.from(c.archive, "base64"));
      const files = new MemoryFiles(), store = new MemoryStore();
      const f = (async (url: string) =>
        String(url).includes("/p/") ? Response.json({ body: c.body, signature: c.signature }) : new Response(bytes)) as unknown as typeof fetch;
      const sc = new ShipvoCapacitor({
        appId: V.appId, shellMajor: V.shellMajor, shellVersion: V.shellVersion, platform: V.platform, publicKey: V.publicKey,
        baseUrl: "https://cp.test", store, files, fetch: f, random: () => 0.5,
      });
      const r = await sc.checkForUpdate({ apply: false });
      const st = await sc.getState();
      if (c.expect === "ok") {
        expect(r.status).toBe("staged");
        expect(st.pendingRelease).toBe(2);
        return;
      }
      expect(st.pendingRelease).toBe(0);
      expect(files.files.size).toBe(0);
      if (c.expect === "shell_too_old") return expect(r.status).toBe("none");
      expect(r.status).toBe("error");
      if (c.expect === "bad_signature") expect(r.error).toMatch(/signature/);
      else if (c.expect === "bad_hash") { expect(r.error).toMatch(/sha-256/); expect(st.blockedRelease).toBe(2); }
      else expect(r.error).toMatch(/pointer|platform|web/);
      if (c.expect !== "bad_hash") expect(st.blockedRelease).toBeUndefined();
    });
  }
});
