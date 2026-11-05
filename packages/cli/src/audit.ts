// `shipvo audit <app>`: export an app's audit log as JSON or CSV on stdout.
import { args as parse, loadConfig, publishToken } from "./config.js";

export const AUDIT_FLAGS = ["format", "limit"];
export const AUDIT_COLUMNS = ["id", "app_id", "at", "actor", "actor_kind", "action", "release", "release_id", "before", "after"] as const;
const PAGE = 200;

export const AUDIT_HELP = `Usage: shipvo audit <app> [--format json|csv] [--limit n]

Print the app's audit log, newest first, to stdout. Pages through the control plane.

Flags (write a value after a space, not =):
  --format json|csv   Output format (default json)
  --limit n           Stop after n entries (default: all)
  --help              Show this help

Needs SHIPVO_OWNER_TOKEN, or the publish token from shipvo app create (SHIPVO_PUBLISH_TOKEN or .shipvo/publish-token).
`;

type Row = Record<string, unknown> & { id: number };

/** One CSV field: quoted, with "" for quotes. Values that start with = + - @ get a leading ' so spreadsheets do not run them. */
export function csvField(v: unknown): string {
  let s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(rows: Row[]): string {
  return [AUDIT_COLUMNS.map(csvField).join(","), ...rows.map((r) => AUDIT_COLUMNS.map((c) => csvField(r[c])).join(","))].join("\n");
}

export async function audit(argv: string[], deps: { fetchFn?: typeof fetch } = {}) {
  if (argv.includes("--help") || argv.includes("-h")) { console.log(AUDIT_HELP); return; }
  const bad = argv.filter((x) => x.startsWith("--") && !AUDIT_FLAGS.includes(x.slice(2)));
  if (bad.length) throw new Error(`Unknown flag ${bad.join(", ")}. Known flags: ${AUDIT_FLAGS.map((k) => "--" + k).join(" ")}`);
  const a = parse(argv);
  // Positional app id: the first argument that is not a flag or a flag's value.
  const appId = argv.find((x, i) => !x.startsWith("--") && !(i > 0 && AUDIT_FLAGS.includes(argv[i - 1].slice(2)) && argv[i - 1].startsWith("--")));
  if (!appId) throw new Error("Usage: shipvo audit <app> [--format json|csv] [--limit n]");
  const format = a.format ?? "json";
  if (format !== "json" && format !== "csv") throw new Error(`--format must be json or csv (got "${a.format}").`);
  let max = Infinity;
  if (argv.includes("--limit")) {
    max = Number(a.limit);
    if (!Number.isInteger(max) || max < 1) throw new Error(`--limit must be a positive whole number (got "${a.limit}").`);
  }
  const token = process.env.SHIPVO_OWNER_TOKEN?.trim() || publishToken();
  if (!token) throw new Error("No credentials. Set SHIPVO_OWNER_TOKEN, or run `shipvo app create` to get a publish token (SHIPVO_PUBLISH_TOKEN or .shipvo/publish-token).");
  const base = loadConfig().controlPlane.replace(/\/$/, "");
  const f = deps.fetchFn ?? fetch;

  const rows: Row[] = [];
  let before: number | undefined;
  while (rows.length < max) {
    const want = Math.min(PAGE, max - rows.length);
    const url = `${base}/audit/${encodeURIComponent(appId)}?limit=${want}${before !== undefined ? `&before=${before}` : ""}`;
    let r: Response;
    try { r = await f(url, { headers: { authorization: `Bearer ${token}` } }); }
    catch (e) { throw new Error(`Could not reach the control plane at ${base} (${e instanceof Error ? e.message : String(e)}).`); }
    if (!r.ok) throw new Error(`Audit request failed: HTTP ${r.status}${r.status === 401 ? " (the token was not accepted for this app)" : ""}.`);
    const page = ((await r.json()) as { rows?: Row[] }).rows ?? [];
    rows.push(...page);
    if (page.length < want) break;
    before = page[page.length - 1].id;
  }
  console.log(format === "csv" ? toCsv(rows) : JSON.stringify(rows, null, 2));
}
