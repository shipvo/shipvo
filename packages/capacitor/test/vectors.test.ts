import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ReleasePointerBody } from "@shipvo/schema";
import { sha256Hex, verifyEd25519 } from "../src/verify.js";

// The iOS Swift tests read the same file (ios/Tests/ShipvoBundleTests).
const V = JSON.parse(readFileSync(new URL("../test-vectors/bundle.json", import.meta.url), "utf8"));

describe("shared bundle vectors", () => {
  for (const c of V.cases as { name: string; body: string; signature: string; archive: string; expect: string }[]) {
    it(c.name, async () => {
      const bytes = new Uint8Array(Buffer.from(c.archive, "base64"));
      const signed = await verifyEd25519(c.body, c.signature, V.publicKey);
      if (c.expect === "bad_signature") return expect(signed).toBe(false);
      expect(signed).toBe(true);
      const parsed = ReleasePointerBody.safeParse(JSON.parse(c.body));
      // A pointer the schema rejects (wrong kind or platform) is refused as a bad pointer.
      if (!parsed.success) return expect(c.expect).toBe("bad_pointer");
      const p = parsed.data;
      const hashOk = bytes.byteLength === p.core.size && (await sha256Hex(bytes)) === p.core.sha256;
      if (c.expect === "bad_hash") return expect(hashOk).toBe(false);
      expect(hashOk).toBe(true);
      const pointerOk = p.kind === "web" && (p.platform ?? "android") === V.platform && p.app_id === V.appId && p.shell_major === V.shellMajor && p.band === V.band;
      expect(pointerOk).toBe(c.expect === "ok");
    });
  }
});
