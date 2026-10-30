import { z } from "zod";

const b64 = z.string().regex(/^[A-Za-z0-9+/_-]+={0,2}$/, "base64/base64url");
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "hex sha-256");
const semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

export const RiskTier = z.enum(["standard", "elevated", "restricted"]);

/** A permission the app WILL use. Anything not listed is unavailable to the CMS. */
export const Permission = z.object({
  name: z.string().min(1),
  tier: RiskTier,
  purpose: z.string().min(12, "purpose string must say why, in plain words"),
});

export const ShellManifest = z.object({
  schema_version: z.literal("1.0"),
  app_id: z.string().min(1),
  shell_version: semver,
  shell_major: z.number().int().nonnegative(),
  modules: z.array(z.string()).default([]),
  permissions: z.array(Permission).default([]),
  payments: z.object({
    digital_goods: z.enum(["none", "store_iap", "external_allowed"]),
    physical_goods: z.enum(["none", "stub", "enabled"]),
  }),
  addon_api: z.number().int().positive(),
  control_plane: z.object({ base_url: z.string().url(), cdn_url: z.string().url() }),
  public_key: b64,
  owner_root_public_key: b64,
  signature: b64,
}).superRefine((m, ctx) => {
  const seen = new Set<string>();
  m.permissions.forEach((p, i) => {
    if (seen.has(p.name)) ctx.addIssue({ code: "custom", path: ["permissions", i, "name"], message: "duplicate permission" });
    seen.add(p.name);
  });
});
export type ShellManifest = z.infer<typeof ShellManifest>;

export const Band = z.enum(["b0", "b1", "b2"]);
export const BAND_RANGES: Record<z.infer<typeof Band>, [number, number]> = {
  b0: [0, 10], b1: [10, 100], b2: [100, 1000], // cohort 0-999: 1%, 10% (cumulative), rest
};
/** Band for a local random cohort 0-999. Lower bands see releases first (cumulative). */
export function bandForCohort(cohort: number): z.infer<typeof Band> {
  if (!Number.isInteger(cohort) || cohort < 0 || cohort > 999) throw new RangeError("cohort must be 0-999");
  return cohort < 10 ? "b0" : cohort < 100 ? "b1" : "b2";
}

export const AddonRef = z.object({
  id: z.string().min(1),
  version: semver,
  sha256,
  size: z.number().int().positive(),
  url: z.string().min(1),
  diff_from: z.object({ version: semver, url: z.string().min(1), size: z.number().int().positive() }).optional(),
});

export const ReleasePointer = z.object({
  schema_version: z.literal("1.0"),
  app_id: z.string().min(1),
  shell_major: z.number().int().nonnegative(),
  band: Band,
  release: z.number().int().positive(),
  issued_at: z.string().datetime(),
  core: z.object({ version: semver, sha256, size: z.number().int().positive(), url: z.string().min(1) }),
  addons: z.array(AddonRef).default([]),
  screens: z.array(z.object({ id: z.string(), sha256, size: z.number().int().positive(), url: z.string().min(1) })).default([]),
  min_shell_version: semver,
  new_control_plane: z.object({ base_url: z.string().url(), cdn_url: z.string().url() }).optional(),
  signature: b64,
});
export type ReleasePointer = z.infer<typeof ReleasePointer>;

/** Body of a release pointer as signed on the wire (no signature inside). */
export const ReleasePointerBody = ReleasePointer.omit({ signature: true });
export type ReleasePointerBody = z.infer<typeof ReleasePointerBody>;

/**
 * Wire envelope: `body` is the exact JSON string that was signed; `signature` is Ed25519 over its UTF-8 bytes.
 * Devices verify bytes, then parse. No canonicalisation needed on device.
 */
export const SignedEnvelope = z.object({
  body: z.string().min(2),
  signature: b64,
  key_id: z.string().optional(),
});
export type SignedEnvelope = z.infer<typeof SignedEnvelope>;

/** .pnpkg add-on manifest (inside the signed package). */
export const AddonManifest = z.object({
  schema_version: z.literal("1.0"),
  id: z.string().regex(/^[a-z][a-z0-9_.-]*$/),
  version: semver,
  addon_api: z.number().int().positive(),
  entry: z.string().min(1),
  bytecode_sha256: sha256,
  commands: z.array(z.object({ name: z.string(), description: z.string().min(1), args: z.record(z.any()).default({}) })).default([]),
  requires_modules: z.array(z.string()).default([]),
  requires_permissions: z.array(z.string()).default([]),
  signature: b64,
});
export type AddonManifest = z.infer<typeof AddonManifest>;

export const GateCheckId = z.enum([
  "manifest_valid", "permissions_declared", "purpose_classifier", "modules_in_manifest", "sim_verified_modules",
  "size_budget", "accessibility", "store_policy", "signature",
]);
export const GateReport = z.object({
  schema_version: z.literal("1.0"),
  subject: z.object({ kind: z.enum(["addon", "screen", "release"]), id: z.string(), version: z.string() }),
  checks: z.array(z.object({
    id: GateCheckId, status: z.enum(["pass", "warn", "fail"]), detail: z.string(),
  })).length(9),
  result: z.enum(["pass", "fail"]),
}).superRefine((r, ctx) => {
  const ids = new Set(r.checks.map((c) => c.id));
  if (ids.size !== 9) ctx.addIssue({ code: "custom", message: "all 9 distinct checks required" });
  const anyFail = r.checks.some((c) => c.status === "fail");
  if (anyFail !== (r.result === "fail")) ctx.addIssue({ code: "custom", path: ["result"], message: "result must be fail iff any check fails" });
});
export type GateReport = z.infer<typeof GateReport>;

export const ChangeLogEntry = z.object({
  seq: z.number().int().nonnegative(),
  at: z.string().datetime(),
  actor: z.string().min(1),
  action: z.string().min(1),
  subject: z.string().min(1),
  prev_hash: z.string().regex(/^(0{64}|[0-9a-f]{64})$/),
  hash: sha256,
  signature: b64,
});
export type ChangeLogEntry = z.infer<typeof ChangeLogEntry>;

export const Telemetry = z.object({
  schema_version: z.literal("1.0"),
  app_id: z.string(), release: z.number().int().nonnegative(),
  event: z.enum(["applied", "rolled_back", "crash_loop_revert", "download_failed", "verify_failed"]),
  cold_start_ms: z.number().nonnegative().optional(),
  bytes_downloaded: z.number().int().nonnegative().optional(),
  apply_ms: z.number().nonnegative().optional(),
  device_class: z.enum(["low", "mid", "high"]).optional(),
});
export type Telemetry = z.infer<typeof Telemetry>;

/** Canonical JSON for signing: sorted keys, no whitespace, `signature` excluded. */
export function canonicalize(value: unknown): string {
  const strip = (v: any): any =>
    Array.isArray(v) ? v.map(strip)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, strip(v[k])]))
    : v;
  const { signature: _s, ...rest } = (value as any) ?? {};
  return JSON.stringify(strip(rest));
}
