// `shipvo auto-halt`: show, turn on or turn off auto-halt for this app, through the control plane.
import { args as parse, loadConfig, publishToken } from "./config.js";

export const AUTOHALT_FLAGS = ["threshold", "min-reports", "off", "dry-run"];

export const AUTOHALT_HELP = `Usage: shipvo auto-halt [flags]

Stop serving a release on its own when too many devices fail to apply it.
With no flags, print the current setting.

Flags (write a value after a space, not =):
  --threshold 0.2     Halt when more than this share of reports failed (above 0, at most 1)
  --min-reports 20    Wait for this many reports first (1 to 10000, default 20)
  --off               Turn auto-halt off
  --dry-run           Print what would change, write nothing
  --help              Show this help

Needs SHIPVO_OWNER_TOKEN, or the publish token from shipvo app create (SHIPVO_PUBLISH_TOKEN or .shipvo/publish-token).
`;

type Setting = { enabled: boolean; threshold?: number; min_reports?: number };

const describe = (s: Setting) => (s.enabled ? `auto-halt: on at ${Math.round((s.threshold as number) * 1000) / 10}% after ${s.min_reports} reports` : "auto-halt: off");

export async function autoHalt(argv: string[], deps: { fetchFn?: typeof fetch } = {}) {
  if (argv.includes("--help") || argv.includes("-h")) { console.log(AUTOHALT_HELP); return; }
  const bad = argv.filter((x) => x.startsWith("--") && !AUTOHALT_FLAGS.includes(x.slice(2)));
  if (bad.length) {
    const eq = bad.find((x) => x.includes("="));
    throw new Error(`Unknown flag ${bad.join(", ")}.${eq ? ` Write "${eq.replace("=", " ")}" (a space, not =).` : ""} Known flags: ${AUTOHALT_FLAGS.map((k) => "--" + k).join(" ")}`);
  }
  const a = parse(argv), cfg = loadConfig();
  const dry = argv.includes("--dry-run"), off = argv.includes("--off");
  const hasT = argv.includes("--threshold"), hasM = argv.includes("--min-reports");
  if (off && (hasT || hasM)) throw new Error("--off cannot be combined with --threshold or --min-reports.");
  let threshold: number | undefined, minReports = 20;
  if (hasT || hasM) {
    if (!hasT) throw new Error("--min-reports needs --threshold too, for example --threshold 0.2 --min-reports 20.");
    threshold = a.threshold === "true" || a.threshold === undefined ? NaN : Number(a.threshold);
    if (!(threshold > 0 && threshold <= 1)) throw new Error(`--threshold must be a number above 0 and at most 1, for example 0.2 (got "${a.threshold}").`);
    if (hasM) {
      minReports = a["min-reports"] === "true" || a["min-reports"] === undefined ? NaN : Number(a["min-reports"]);
      if (!Number.isInteger(minReports) || minReports < 1 || minReports > 10000) throw new Error(`--min-reports must be a whole number from 1 to 10000 (got "${a["min-reports"]}").`);
    }
  }

  const token = process.env.SHIPVO_OWNER_TOKEN?.trim() || publishToken();
  if (!token) throw new Error("No credentials. Set SHIPVO_OWNER_TOKEN, or run `shipvo app create` to get a publish token (SHIPVO_PUBLISH_TOKEN or .shipvo/publish-token).");
  const base = cfg.controlPlane.replace(/\/$/, "");
  const url = `${base}/app/${encodeURIComponent(cfg.appId)}/api/halt-config`;
  const call = async (method: string, body?: unknown) => {
    let r: Response;
    try { r = await (deps.fetchFn ?? fetch)(url, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { throw new Error(`Could not reach the control plane at ${base} (${e instanceof Error ? e.message : String(e)}).`); }
    if (r.status === 401 || r.status === 403) throw new Error(`The control plane at ${base} rejected your token (${r.status}). Check SHIPVO_OWNER_TOKEN or your publish token.`);
    if (!r.ok) { let m = ""; try { m = ((await r.json()) as any).message ?? ""; } catch { /* no body */ } throw new Error(`Auto-halt request failed: HTTP ${r.status}${m ? ` ${m}` : ""}`); }
    return (await r.json()) as Setting;
  };

  if (!off && threshold === undefined) { console.log(describe(await call("GET"))); return; }
  const want: Setting = off ? { enabled: false } : { enabled: true, threshold, min_reports: minReports };
  if (dry) { console.log(`Would set ${describe(want)}`); console.log("Dry run: nothing was written."); return; }
  console.log(describe(off ? await call("DELETE") : await call("PUT", { threshold, min_reports: minReports })));
}
