#!/usr/bin/env tsx
import { execFileSync } from "child_process";
import { fileURLToPath } from "node:url";

const SAMPLE_APP = "tide-and-tackle";
// The sample app reports a healthy start as `applied` (apps/tide-and-tackle/App.tsx).
const HEALTHY_EVENT = "applied";

export type Row = { app_id: string; received_at: string; event?: string };

export function filterHealthyRows(
  rows: Array<{ app_id: string; received_at: string; event: string }>
): Array<{ app_id: string; received_at: string }> {
  return rows.filter((r) => r.event === HEALTHY_EVENT).map(({ app_id, received_at }) => ({ app_id, received_at }));
}

export function weeklyHealthyApps(
  rows: Array<{ app_id: string; received_at: string }>
): Map<string, { apps: Set<string>; sampleApp: boolean }> {
  const weeks = new Map<string, { apps: Set<string>; sampleApp: boolean }>();
  for (const row of rows) {
    const week = isoWeek(row.received_at);
    let entry = weeks.get(week);
    if (!entry) {
      entry = { apps: new Set(), sampleApp: false };
      weeks.set(week, entry);
    }
    entry.apps.add(row.app_id);
    if (row.app_id === SAMPLE_APP) entry.sampleApp = true;
  }
  return weeks;
}

export function isoWeek(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const weekNo = Math.ceil(((d.getTime() - start) / 86400000 + 1) / 7);
  return `${year}-W${String(weekNo).padStart(2, "0")}`;
}

async function main() {
  const databaseId = process.env.D1_DATABASE_ID;
  if (!databaseId || !/^[a-z0-9-]+$/i.test(databaseId)) {
    console.error("Set D1_DATABASE_ID env var (see services/control-plane/wrangler.toml)");
    process.exit(1);
  }

  const sql = `SELECT app_id, received_at, event FROM telemetry;`;
  const output = execFileSync("wrangler", ["d1", "execute", databaseId, "--remote", "--command", sql, "--json"]).toString();

  const result = JSON.parse(output);
  const rows = result[0]?.results ?? [];

  const healthy = filterHealthyRows(rows);
  const weeks = weeklyHealthyApps(healthy);
  for (const [week, entry] of [...weeks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const sampleMarker = entry.sampleApp ? `, ${entry.apps.has(SAMPLE_APP) ? 1 : 0} sample` : "";
    const sampleCount = entry.sampleApp ? 1 : 0;
    console.log(`${week}: ${entry.apps.size} app${entry.apps.size !== 1 ? "s" : ""}, ${sampleCount} sample${sampleMarker ? "" : ""}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
