import { describe, it, expect } from "vitest";
import { satisfiesRange, checkNativeModules, ShellManifest, ReleasePointer, GateReport, bandForCohort, canonicalize, parsePolicy } from "../src/index";

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
import { SignedEnvelope, ReleasePointerBody } from "../src/index";
describe("envelope", () => {
  it("parses envelope and unsigned body", () => {
    const h = "a".repeat(64);
    const body = { schema_version: "1.0", app_id: "tide", shell_major: 1, band: "b0", release: 1, issued_at: "2026-10-30T00:00:00Z",
      core: { version: "1.0.0", sha256: h, size: 10, url: "c" }, min_shell_version: "1.0.0" };
    expect(ReleasePointerBody.safeParse(body).success).toBe(true);
    expect(SignedEnvelope.safeParse({ body: JSON.stringify(body), signature: "AAAA" }).success).toBe(true);
  });
});

describe("native modules", () => {
  const rel = { schema_version: "1.0", app_id: "tide", shell_major: 1, band: "b0", release: 3, issued_at: "2026-10-30T00:00:00Z",
    core: { version: "1.0.0", sha256: "a".repeat(64), size: 10, url: "c" }, min_shell_version: "1.0.0", signature: sig };
  it("both fields are optional and parse when present", () => {
    const m = ShellManifest.safeParse(manifest); expect(m.success && m.data.native_modules).toBeUndefined();
    const m2 = ShellManifest.safeParse({ ...manifest, native_modules: { "react-native-camera-kit": "14.1.0" } });
    expect(m2.success && m2.data.native_modules).toEqual({ "react-native-camera-kit": "14.1.0" });
    expect(ShellManifest.safeParse({ ...manifest, native_modules: { x: "latest" } }).success).toBe(false);
    const r = ReleasePointer.safeParse(rel); expect(r.success && r.data.required_native_modules).toBeUndefined();
    const r2 = ReleasePointer.safeParse({ ...rel, required_native_modules: { x: "^1.0.0" } });
    expect(r2.success && r2.data.required_native_modules).toEqual({ x: "^1.0.0" });
  });
  it("satisfiesRange", () => {
    expect(satisfiesRange("1.2.3", "^1.0.0")).toBe(true);
    expect(satisfiesRange("2.0.0", "^1.0.0")).toBe(false);
    expect(satisfiesRange("0.2.5", "^0.2.1")).toBe(true);
    expect(satisfiesRange("0.3.0", "^0.2.1")).toBe(false);
    expect(satisfiesRange("2.1.9", "~2.1.0")).toBe(true);
    expect(satisfiesRange("2.2.0", "~2.1.0")).toBe(false);
    expect(satisfiesRange("1.5.0", ">=1.2.0 <2.0.0")).toBe(true);
    expect(satisfiesRange("3.0.0", "^1.0.0 || ^3.0.0")).toBe(true);
    expect(satisfiesRange("1.9.0", "1.x")).toBe(true);
    expect(satisfiesRange("1.2.3", "*")).toBe(true);
    expect(satisfiesRange("1.2.3", "banana")).toBe(false);
    expect(satisfiesRange("1.5.0", "1.2.3 - 2.0.0")).toBe(true);
    expect(satisfiesRange("2.0.1", "1.2.3 - 2.0.0")).toBe(false);
    expect(satisfiesRange("1.0.0", "1.2.3 - 2.0.0")).toBe(false);
    expect(satisfiesRange("1.5.0", ">= 1.0.0")).toBe(true);
    expect(satisfiesRange("0.5.0", ">= 1.0.0")).toBe(false);
    expect(satisfiesRange("1.5.0", ">= 1.2.0 < 2.0.0")).toBe(true);
    expect(satisfiesRange("1.2.5", "^ 1.2.0")).toBe(true);
    expect(satisfiesRange("1.2.5", "<=1.2")).toBe(true);
    expect(satisfiesRange("1.3.0", "<=1.2")).toBe(false);
    expect(satisfiesRange("1.9.9", "<=1")).toBe(true);
    expect(satisfiesRange("2.0.0", "<=1")).toBe(false);
    expect(satisfiesRange("1.2.4", "<=1.2.3")).toBe(false);
  });
  it("satisfiesRange covers partial, caret and zero-major edges", () => {
    const cases: [string, string, boolean][] = [
      ["1.2.3", "=1.2.3", true], ["1.2.3", "v1.2.3", true], ["1.2.4", "1.2.3", false],
      ["1.9.9", "1", true], ["2.0.0", "1", false], ["1.2.9", "1.2", true], ["1.3.0", "1.2", false],
      ["0.0.3", "^0.0.3", true], ["0.0.4", "^0.0.3", false], ["0.5.0", "^0", true], ["1.0.0", "^0", false],
      ["0.0.9", "^0.0", true], ["0.1.0", "^0.0", false], ["1.4.0", "^1.2.x", true], ["2.0.0", "^1.2.x", false],
      ["1.9.0", "~1", true], ["2.0.0", "~1", false], ["1.0.0", ">1", false], ["2.0.0", ">1", true],
      ["1.2.9", ">1.2", false], ["1.5.0", ">1.2", true], ["1.9.9", "<2", true], ["2.0.0", "<2", false],
      ["1.3.0", "<1.3", false], ["2.0.0", "1.x || 2.x", true], ["3.0.0", "1.x || 2.x", false],
      ["1.1.0", "^1.0.0 ^1.2.0", false], ["1.2.3", "^1.0.0 banana", false], ["10.0.0", "^1.0.0", false],
      ["1.10.0", "1.1.x", false], ["1.2", "^1.0.0", false], ["1.2.3", ">=1.2.3-rc.1", true],
    ];
    for (const [v, r, want] of cases) expect([v, r, satisfiesRange(v, r)]).toEqual([v, r, want]);
  });
  it("satisfiesRange rejects ranges with trailing junk", () => {
    expect(satisfiesRange("1.2.3", "1.2.3foo")).toBe(false);
    expect(satisfiesRange("1.2.3", "1.2.3.4")).toBe(false);
    expect(satisfiesRange("1.2.3", "^1.0.0abc")).toBe(false);
    expect(satisfiesRange("1.2.3", "1.2.3-beta.1")).toBe(true);
  });
  it("checkNativeModules gives typed reasons", () => {
    expect(checkNativeModules({ x: "^1.0.0" }, { y: "1.0.0" })).toEqual({ reason: "native_module_missing", module: "x", required: "^1.0.0" });
    expect(checkNativeModules({ x: "^2.0.0" }, { x: "1.0.0" })?.reason).toBe("native_module_version");
    expect(checkNativeModules({ x: "^1.0.0" }, { x: "1.4.0" })).toBeNull();
    expect(checkNativeModules(undefined, { x: "1.0.0" })).toBeNull();
    expect(checkNativeModules({ x: "^1.0.0" }, undefined)).toBeNull();
  });
});

describe("parsePolicy", () => {
  it("accepts a full policy and an empty one", () => {
    expect(parsePolicy({})).toEqual({});
    expect(parsePolicy({ maxBand: "b1", agentMaxBand: "b0", blockedWeekdays: ["fri"], blockedAfterHour: 12 })).toMatchObject({ maxBand: "b1" });
  });
  it("names the bad field", () => {
    expect(() => parsePolicy({ maxBand: "b9" })).toThrow(/policy\.maxBand/);
    expect(() => parsePolicy({ blockedAfterHour: 5 })).toThrow(/policy\.blockedAfterHour/);
  });
  it("parses maxCohortForAgents and requireStageBeforeFull", () => {
    expect(parsePolicy({ maxCohortForAgents: "b1", requireStageBeforeFull: { percent: 10, minHours: 24 } })).toEqual({ maxCohortForAgents: "b1", requireStageBeforeFull: { percent: 10, minHours: 24 } });
    expect(parsePolicy({ maxCohortForAgents: 25 }).maxCohortForAgents).toBe(25);
  });
  it("rejects bad values and unknown keys in the new rules", () => {
    expect(() => parsePolicy({ maxCohortForAgents: 0 })).toThrow(/policy\.maxCohortForAgents/);
    expect(() => parsePolicy({ maxCohortForAgents: 101 })).toThrow(/policy\.maxCohortForAgents/);
    expect(() => parsePolicy({ maxCohortForAgents: "everyone" })).toThrow(/policy\.maxCohortForAgents/);
    expect(() => parsePolicy({ requireStageBeforeFull: { percent: 100, minHours: 1 } })).toThrow(/requireStageBeforeFull\.percent/);
    expect(() => parsePolicy({ requireStageBeforeFull: { percent: 10, minHours: 0 } })).toThrow(/requireStageBeforeFull\.minHours/);
    expect(() => parsePolicy({ requireStageBeforeFull: { percent: 10, minHours: 1, extra: 1 } })).toThrow(/requireStageBeforeFull/);
    expect(() => parsePolicy({ nope: true })).toThrow(/policy/);
  });
});
