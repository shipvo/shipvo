// Per-release health: one read-only answer to "is this release healthy?", from existing telemetry rows and KV.
import { FAILED_EVENTS, HEALTHY_EVENTS } from "./halt";

export type Platform = "android" | "ios";
/** `unknown`: reports with neither an Android API level nor an Apple device model. */
export type Attributed = Platform | "unknown";
export type Row = { release: number; platform: Attributed; event: string; n: number };
export type PlatformHealth = {
  /** Reports that the update was applied (`applied` and `content_applied`). */
  applied: number;
  /** Same count, as healthy reports (see HEALTHY_EVENTS in halt.ts). */
  healthy: number;
  /** `crash_loop_revert` reports. */
  reverted: number;
  /** Other failure reports: rolled_back, verify_failed, download_failed. */
  failed: number;
  /** Bands whose live pointer serves this release on this platform. */
  bands: string[];
  /** Bands that serve this release while it is halted; empty when it is not halted. */
  halted_bands: string[];
};
export type ReleaseHealth = { release: number; halted: boolean; platforms: Record<Attributed, PlatformHealth> };

const BANDS = ["b0", "b1", "b2"];
const empty = (): PlatformHealth => ({ applied: 0, healthy: 0, reverted: 0, failed: 0, bands: [], halted_bands: [] });

/** Telemetry carries no platform column. An Android API level means Android; an iPhone, iPad or iPod model means iOS; any other row is `unknown`, never guessed. */
export const PLATFORM_SQL = "CASE WHEN android_api IS NOT NULL THEN 'android' WHEN device_model LIKE 'iPhone%' OR device_model LIKE 'iPad%' OR device_model LIKE 'iPod%' THEN 'ios' ELSE 'unknown' END";

export const HEALTH_SQL =
  `SELECT release, ${PLATFORM_SQL} AS platform, event, COUNT(*) AS n FROM telemetry WHERE app_id = ? AND verified = 1 ` +
  "AND release IN (SELECT release FROM telemetry WHERE app_id = ? GROUP BY release ORDER BY MAX(id) DESC LIMIT 20) GROUP BY release, platform, event";

/** Pure: fold telemetry counts, live pointers (platform -> band -> release) and the halted release into a list, newest release first. */
export function buildHealth(rows: Row[], live: Record<Platform, Record<string, number>>, haltedRelease: number | null): ReleaseHealth[] {
  const byRelease = new Map<number, ReleaseHealth>();
  const get = (release: number) => {
    let r = byRelease.get(release);
    if (!r) { r = { release, halted: haltedRelease === release, platforms: { android: empty(), ios: empty(), unknown: empty() } }; byRelease.set(release, r); }
    return r;
  };
  for (const row of rows) {
    const p = get(row.release).platforms[row.platform];
    if (HEALTHY_EVENTS.includes(row.event)) { p.applied += row.n; p.healthy += row.n; }
    else if (row.event === "crash_loop_revert") { p.reverted += row.n; p.failed += row.n; }
    else if (FAILED_EVENTS.includes(row.event)) p.failed += row.n;
  }
  for (const plat of ["android", "ios"] as const) {
    for (const band of BANDS) {
      const rel = live[plat][band];
      if (rel === undefined) continue;
      const r = get(rel);
      r.platforms[plat].bands.push(band);
      if (r.halted) r.platforms[plat].halted_bands.push(band);
    }
  }
  return [...byRelease.values()].sort((a, b) => b.release - a.release);
}
