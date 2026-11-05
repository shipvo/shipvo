import { args, loadConfig } from "./config.js";

type Row = { release: number; events: Record<string, number>; apply_ms_median: number | null; cold_start_ms_median: number | null };

const ms = (v: number | null | undefined) => (typeof v === "number" ? String(Math.round(v)) : "-");

/** Plain-text table: one row per release, one column per event name, then the two medians. */
export function formatStatus(releases: Row[]): string {
  const names = [...new Set(releases.flatMap((r) => Object.keys(r.events ?? {})))].sort();
  const rows = [["release", ...names, "apply ms", "cold start ms"],
    ...releases.map((r) => [String(r.release), ...names.map((n) => String(r.events?.[n] ?? 0)), ms(r.apply_ms_median), ms(r.cold_start_ms_median)])];
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join("  ")).join("\n");
}

export async function status(argv: string[], fetchFn: typeof fetch = fetch): Promise<number> {
  const a = args(argv);
  const cfg = loadConfig();
  const appId = a.app && a.app !== "true" ? a.app : cfg.appId;
  const base = cfg.controlPlane.replace(/\/$/, "");
  const url = `${base}/t/${encodeURIComponent(appId)}/summary`;
  let data: { releases?: Row[] };
  try {
    const r = await fetchFn(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = (await r.json()) as { releases?: Row[] };
  } catch (e) {
    console.error(`Could not reach the control plane at ${base} (${e instanceof Error ? e.message : String(e)}).`);
    return 1;
  }
  if (argv.includes("--json")) { console.log(JSON.stringify(data)); return 0; }
  const releases = data.releases ?? [];
  if (!releases.length) { console.log(`No telemetry yet for "${appId}".`); return 0; }
  console.log(formatStatus(releases));
  return 0;
}
