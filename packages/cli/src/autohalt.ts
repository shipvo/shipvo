// `shipvo auto-halt`: show, turn on or turn off auto-halt for this app, through the control plane.
import { args as parse, loadConfig, publishToken } from "./config.js";
import { describeAutoHalt } from "./status.js";
import { CliFailure, UsageError, runJson, type Done } from "./json-out.js";

export const AUTOHALT_FLAGS = ["threshold", "min-reports", "off", "dry-run", "json"];

export const AUTOHALT_HELP = `Usage: shipvo auto-halt [flags]

Stop serving a release on its own when too many devices fail to apply it.
With no flags, print the current setting.

Flags (write a value after a space, not =):
  --threshold 0.2     Halt when more than this share of reports failed (above 0, at most 1)
  --min-reports 50    Wait for this many reports first (1 to 10000, default 50)
  --off               Turn auto-halt off
  --dry-run           Print what would change, write nothing
  --json              Print one JSON envelope on stdout; text goes to stderr
  --help              Show this help

Needs SHIPVO_OWNER_TOKEN, or the publish token from shipvo app create (SHIPVO_PUBLISH_TOKEN or .shipvo/publish-token).
`;

type Setting = { enabled: boolean; threshold?: number; min_reports?: number };

const describe = (s: Setting) => describeAutoHalt(s.enabled ? { threshold: s.threshold as number, min_reports: s.min_reports as number } : null);

export async function autoHalt(argv: string[], deps: { fetchFn?: typeof fetch } = {}) {
  if (argv.includes("--help") || argv.includes("-h")) { console.log(AUTOHALT_HELP); return; }
  if (argv.includes("--json")) return runJson(() => autoHaltRun(argv, deps), [{ command: "shipvo doctor --json", why: "Check your setup." }]);
  await autoHaltRun(argv, deps);
}

async function autoHaltRun(argv: string[], deps: { fetchFn?: typeof fetch }): Promise<Done> {
  const bad = argv.filter((x) => x.startsWith("--") && !AUTOHALT_FLAGS.includes(x.slice(2)));
  if (bad.length) {
    const eq = bad.find((x) => x.includes("="));
    throw new UsageError(`Unknown flag ${bad.join(", ")}.${eq ? ` Write "${eq.replace("=", " ")}" (a space, not =).` : ""} Known flags: ${AUTOHALT_FLAGS.map((k) => "--" + k).join(" ")}`);
  }
  const a = parse(argv), cfg = loadConfig();
  const dry = argv.includes("--dry-run"), off = argv.includes("--off");
  const hasT = argv.includes("--threshold"), hasM = argv.includes("--min-reports");
  if (off && (hasT || hasM)) throw new UsageError("--off cannot be combined with --threshold or --min-reports.");
  let threshold: number | undefined, minReports = 20;
  if (hasT || hasM) {
    if (!hasT) throw new UsageError("--min-reports needs --threshold too, for example --threshold 0.2 --min-reports 20.");
    threshold = a.threshold === "true" || a.threshold === undefined ? NaN : Number(a.threshold);
    if (!(threshold > 0 && threshold <= 1)) throw new UsageError(`--threshold must be a number above 0 and at most 1, for example 0.2 (got "${a.threshold}").`);
    if (hasM) {
      minReports = a["min-reports"] === "true" || a["min-reports"] === undefined ? NaN : Number(a["min-reports"]);
      if (!Number.isInteger(minReports) || minReports < 1 || minReports > 10000) throw new UsageError(`--min-reports must be a whole number from 1 to 10000 (got "${a["min-reports"]}").`);
    }
  }

  const token = process.env.SHIPVO_OWNER_TOKEN?.trim() || publishToken();
  if (!token) throw new CliFailure("No credentials. Set SHIPVO_OWNER_TOKEN, or run `shipvo app create` to get a publish token (SHIPVO_PUBLISH_TOKEN or .shipvo/publish-token).", "no_credentials", 1, [{ command: "shipvo app create", why: "Get a publish token." }]);
  const base = cfg.controlPlane.replace(/\/$/, "");
  const url = `${base}/app/${encodeURIComponent(cfg.appId)}/api/halt-config`;
  const call = async (method: string, body?: unknown) => {
    let r: Response;
    try { r = await (deps.fetchFn ?? fetch)(url, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { throw new CliFailure(`Could not reach the control plane at ${base} (${e instanceof Error ? e.message : String(e)}).`, "remote_failed", 1, [{ command: "shipvo doctor --json", why: "Check the control plane." }]); }
    if (r.status === 401 || r.status === 403) throw new CliFailure(`The control plane at ${base} rejected your token (${r.status}). Check SHIPVO_OWNER_TOKEN or your publish token.`, "auth_failed", 1, [{ command: "shipvo app create", why: "Get a publish token, or set SHIPVO_OWNER_TOKEN." }]);
    if (!r.ok) { let m = ""; try { m = ((await r.json()) as any).message ?? ""; } catch { /* no body */ } throw new CliFailure(`Auto-halt request failed: HTTP ${r.status}${m ? ` ${m}` : ""}`, "remote_failed", 1, [{ command: "shipvo doctor --json", why: "Check the control plane." }]); }
    return (await r.json()) as Setting;
  };

  const status = [{ command: "shipvo status --json", why: "See how the newest releases do." }];
  const done = (code: string, st: Setting, extra: Record<string, unknown> = {}): Done => {
    console.log(describe(st));
    return { code, summary: describe(st), data: { enabled: st.enabled, threshold: st.enabled ? st.threshold ?? null : null, min_reports: st.enabled ? st.min_reports ?? null : null, dry_run: false, changed: false, ...extra }, next: status };
  };
  if (!off && threshold === undefined) return done("auto_halt_show", await call("GET"));
  const want: Setting = off ? { enabled: false } : { enabled: true, threshold, min_reports: minReports };
  if (dry) {
    console.log(`Would set ${describe(want)}`); console.log("Dry run: nothing was written.");
    const real = argv.filter((x) => x !== "--dry-run");
    return { code: "dry_run", summary: `Would set ${describe(want)}`, data: { enabled: want.enabled, threshold: want.threshold ?? null, min_reports: want.min_reports ?? null, dry_run: true, changed: false }, next: [{ command: `shipvo auto-halt ${real.join(" ")}`.trim(), why: "Apply this setting." }] };
  }
  const st = off ? await call("DELETE") : await call("PUT", { threshold, min_reports: minReports });
  return done(off ? "auto_halt_off" : "auto_halt_on", st, { changed: true });
}
