// North-star query: per week, the distinct app IDs with at least one `healthy` telemetry row.
// Read-only: one SELECT through the Cloudflare D1 HTTP API. Prints counts and app IDs, never device data.
// Usage: node scripts/north-star/weekly-healthy.mjs [--weeks 12] [--sample tide,tide-and-tackle]
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, SHIPVO_D1_ID (defaults to database_id in
// services/control-plane/wrangler.toml). Token needs D1: Read.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SAMPLE_APPS = ["tide", "tide-and-tackle"];

// Week = Monday (UTC) of received_at. No device columns are selected.
export function buildSql(weeks) {
  const n = Math.max(1, Math.min(520, Math.floor(Number(weeks)) || 12));
  return `SELECT date(received_at, '-6 days', 'weekday 1') AS week, app_id FROM telemetry WHERE event = 'healthy' AND received_at >= date('now', '-${n * 7} days') GROUP BY week, app_id ORDER BY week, app_id`;
}

/** rows: [{week, app_id}] (one per week and app). Returns [{week, apps, others, sample}]. */
export function summarize(rows, sampleApps = SAMPLE_APPS) {
  const sample = new Set(sampleApps);
  const byWeek = new Map();
  for (const r of rows) {
    if (!byWeek.has(r.week)) byWeek.set(r.week, new Set());
    byWeek.get(r.week).add(r.app_id);
  }
  return [...byWeek.keys()].sort().map((week) => {
    const ids = [...byWeek.get(week)].sort();
    const s = ids.filter((id) => sample.has(id));
    return { week, apps: ids.length, others: ids.length - s.length, sample: s.length > 0, appIds: ids };
  });
}

export function format(summary, sampleApps = SAMPLE_APPS) {
  const lines = ["| week (Mon, UTC) | apps | apps other than sample | sample app healthy |", "| --- | ---: | ---: | --- |"];
  for (const w of summary) lines.push(`| ${w.week} | ${w.apps} | ${w.others} | ${w.sample ? "yes" : "no"} |`);
  if (!summary.length) lines.push("| (no healthy rows in range) | 0 | 0 | no |");
  lines.push("", `Sample app IDs: ${sampleApps.join(", ")}`);
  return lines.join("\n");
}

function defaultDbId() {
  try {
    const toml = readFileSync(fileURLToPath(new URL("../../services/control-plane/wrangler.toml", import.meta.url)), "utf8");
    return /database_id\s*=\s*"([^"]+)"/.exec(toml)?.[1];
  } catch { return undefined; }
}

export async function query(sql, env = process.env, fetchFn = fetch) {
  const token = env.CLOUDFLARE_API_TOKEN, account = env.CLOUDFLARE_ACCOUNT_ID, db = env.SHIPVO_D1_ID || defaultDbId();
  if (!token || !account || !db) throw new Error("Set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and (optionally) SHIPVO_D1_ID.");
  const res = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${db}/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(`D1 query failed (HTTP ${res.status}): ${(body.errors ?? []).map((e) => e.message).join("; ") || "no detail"}`);
  return body.result?.[0]?.results ?? [];
}

async function main() {
  const a = process.argv.slice(2);
  const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const sample = opt("--sample")?.split(",").filter(Boolean) ?? SAMPLE_APPS;
  const rows = await query(buildSql(opt("--weeks") ?? 12));
  console.log(format(summarize(rows, sample), sample));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
