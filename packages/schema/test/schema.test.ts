import { describe, it, expect } from "vitest";
import { ShellManifest, ReleasePointer, GateReport, bandForCohort, canonicalize } from "../src/index";

const sig = "AAAA".repeat(16);
const manifest = {
  schema_version: "1.0", app_id: "tide", shell_version: "1.0.0", shell_major: 1,
  modules: ["camera"], permissions: [{ name: "camera", tier: "elevated", purpose: "Scan fishing licence barcodes" }],
  payments: { digital_goods: "none", physical_goods: "stub" }, addon_api: 1,
  control_plane: { base_url: "https://x.workers.dev", cdn_url: "https://x.workers.dev" },
  public_key: sig, owner_root_public_key: sig, signature: sig,
};
describe("manifest", () => {
  it("parses a manifest with and without hermes_bytecode_versions", () => {
    const old = ShellManifest.safeParse(manifest);
    expect(old.success && old.data.hermes_bytecode_versions).toBeUndefined();
    const v = ShellManifest.safeParse({ ...manifest, hermes_bytecode_versions: [96, 98] });
    expect(v.success && v.data.hermes_bytecode_versions).toEqual([96, 98]);
    expect(ShellManifest.safeParse({ ...manifest, hermes_bytecode_versions: [] }).success).toBe(false);
  });
  it("accepts a valid manifest", () => expect(ShellManifest.safeParse(manifest).success).toBe(true));
  it("rejects vague purpose strings", () =>
    expect(ShellManifest.safeParse({ ...manifest, permissions: [{ name: "camera", tier: "elevated", purpose: "stuff" }] }).success).toBe(false));
  it("rejects duplicate permissions", () => {
    const p = manifest.permissions[0];
    expect(ShellManifest.safeParse({ ...manifest, permissions: [p, p] }).success).toBe(false);
  });
});
describe("cohort bands", () => {
  it("maps 0-999 to b0/b1/b2", () => {
    expect([0, 9, 10, 99, 100, 999].map(bandForCohort)).toEqual(["b0", "b0", "b1", "b1", "b2", "b2"]);
    expect(() => bandForCohort(1000)).toThrow();
  });
});
describe("release pointer", () => {
  it("requires hashes and signature", () => {
    const h = "a".repeat(64);
    const ok = ReleasePointer.safeParse({ schema_version: "1.0", app_id: "tide", shell_major: 1, band: "b0", release: 1,
      issued_at: "2026-10-29T21:00:00Z", core: { version: "1.0.0", sha256: h, size: 10, url: "c" }, min_shell_version: "1.0.0", signature: sig });
    expect(ok.success).toBe(true);
  });
  it("parses with and without hermes_bytecode_version", () => {
    const h = "a".repeat(64);
    const base = { schema_version: "1.0", app_id: "tide", shell_major: 1, band: "b0", release: 1,
      issued_at: "2026-10-29T21:00:00Z", core: { version: "1.0.0", sha256: h, size: 10, url: "c" }, min_shell_version: "1.0.0", signature: sig };
    const old = ReleasePointer.safeParse(base);
    expect(old.success && old.data.hermes_bytecode_version).toBeUndefined();
    const withV = ReleasePointer.safeParse({ ...base, hermes_bytecode_version: 96 });
    expect(withV.success && withV.data.hermes_bytecode_version).toBe(96);
    expect(ReleasePointer.safeParse({ ...base, hermes_bytecode_version: 1.5 }).success).toBe(false);
  });
});
describe("gate report", () => {
  const ids = ["manifest_valid","permissions_declared","purpose_classifier","modules_in_manifest","sim_verified_modules","size_budget","accessibility","store_policy","signature"];
  const mk = (failId?: string, result = "pass") => ({ schema_version: "1.0", subject: { kind: "addon", id: "a", version: "1.0.0" },
    checks: ids.map((id) => ({ id, status: id === failId ? "fail" : "pass", detail: "x" })), result });
  it("passes when all pass", () => expect(GateReport.safeParse(mk()).success).toBe(true));
  it("fails result consistency", () => expect(GateReport.safeParse(mk("signature", "pass")).success).toBe(false));
});
describe("canonicalize", () => {
  it("is key-order independent and excludes signature", () =>
    expect(canonicalize({ b: 1, a: { d: 1, c: 2 }, signature: "x" })).toBe(canonicalize({ a: { c: 2, d: 1 }, b: 1 })));
});
import { SignedEnvelope, ReleasePointerBody, Telemetry } from "../src/index";
describe("telemetry", () => {
  const base = { schema_version: "1.0", app_id: "a", release: 5 };
  it("accepts hermes_bytecode_mismatch", () => expect(Telemetry.safeParse({ ...base, event: "hermes_bytecode_mismatch" }).success).toBe(true));
  it("still rejects unknown events", () => expect(Telemetry.safeParse({ ...base, event: "nope" }).success).toBe(false));
});
describe("envelope", () => {
  it("parses envelope and unsigned body", () => {
    const h = "a".repeat(64);
    const body = { schema_version: "1.0", app_id: "tide", shell_major: 1, band: "b0", release: 1, issued_at: "2026-10-30T00:00:00Z",
      core: { version: "1.0.0", sha256: h, size: 10, url: "c" }, min_shell_version: "1.0.0" };
    expect(ReleasePointerBody.safeParse(body).success).toBe(true);
    expect(SignedEnvelope.safeParse({ body: JSON.stringify(body), signature: "AAAA" }).success).toBe(true);
  });
});
