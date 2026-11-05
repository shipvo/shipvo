#!/usr/bin/env tsx
import { execSync } from "child_process";

const SAMPLE_APP = "tide-and-tackle";

export function weeklyHealthyApps(
  rows: Array<{ app_id: string; published_at: string }>
): Map<string, { apps: Set<string>; sampleApp: boolean }> {
  const weeks = new Map<string, { apps: Set<string>; sampleApp: boolean }>();
  for (const row of rows) {
    const week = isoWeek(row.published_at);
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

function isoWeek(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const ms = d.getTime();
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const weekNo = Math.ceil(((ms - start) / 86400000 + 1) / 7);
  return `${year}-W${String(weekNo).padStart(2, "0")}`;
}

async function main() {
  const databaseId = process.env.D1_DATABASE_ID;
  if (!databaseId) {
    console.error("Set D1_DATABASE_ID env var (see wrangler.toml)");
    process.exit(1);
  }

  const sql = `SELECT app_id, published_at FROM telemetry WHERE event = 'healthy';`;
  const output = execSync(`wrangler d1 execute ${databaseId} --command="${sql}" --format=json`).toString();

  const result = JSON.parse(output);
  const rows = result[0]?.results ?? [];

  const weeks = weeklyHealthyApps(rows);
  for (const [week, entry] of [...weeks.entries()].sort()) {
    const sampleMarker = entry.sampleApp ? ` (includes sample app: ${SAMPLE_APP})` : "";
    console.log(`${week}: ${entry.apps.size} app${entry.apps.size !== 1 ? "s" : ""}${sampleMarker}`);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
