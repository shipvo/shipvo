// `shipvo promote`: widen a staged release to more bands. Reads the pointer on the narrowest band that has one,
// and writes the same release (same bundle, hashes and patches) to the other bands with a fresh issued_at and signature.
import { existsSync, readFileSync } from "node:fs";
import { signBytes } from "./index.js";
import { CliFailure, UsageError, runJson, type Done, type Next } from "./json-out.js";
import { args as parse, kv as kvFor, loadConfig, seed } from "./config.js";

const BANDS = ["b0", "b1", "b2"];
const REVERT_EVENTS = ["rolled_back", "crash_loop_revert"];
type Platform = "android" | "ios";
type Store = Pick<ReturnType<typeof kvFor>, "get" | "put">;
type Summary = { releases?: { release: number; events?: Record<string, number> }[]; halted?: { release: number } | null };

const pointerKey = (app: string, major: number, band: string, pf: Platform) => (pf === "ios" ? `p/${app}/${major}/ios/${band}` : `p/${app}/${major}/${band}`);

export const PROMOTE_FLAGS = ["to", "platform", "dry-run", "force", "report", "json"];

export const PROMOTE_HELP = `Usage: shipvo promote [flags]

Widen a staged release to more bands. The release number, bundle and patches stay the same; the pointer is signed again.

Flags (write a value after a space, not =):
  --to b1,b2                   Bands to write (default: every band with no pointer for this release)
                               Bands that already hold a newer release are always skipped
  --platform android|ios|all   Platform to promote (default android)
  --dry-run                    Print the plan, write nothing
  --report <file>              Test report from shipvo test --report (default shipvo-test-report.json if it exists)
                               A report for this release with failing flows blocks promote
  --json                       Print one JSON envelope on stdout; text goes to stderr
  --force                      Promote even if the release is halted, has reverts or has a failing test report
  --help                       Show this help
`;

function checkFlags(argv: string[], known: string[]) {
  const bad = argv.filter((x) => x.startsWith("--") && !known.includes(x.slice(2)));
  if (bad.length) {
    const eq = bad.find((x) => x.includes("="));
    const hint = eq ? ` Write "${eq.replace("=", " ")}" (a space, not =).` : "";
    throw new UsageError(`Unknown flag ${bad.join(", ")}.${hint} Known flags: ${known.map((k) => "--" + k).join(" ")}`);
  }
}

const STATUS: Next[] = [{ command: "shipvo status --json", why: "See how the release does on phones." }];

export async function promote(argv: string[], deps: { kv?: Store; fetchFn?: typeof fetch } = {}) {
  if (argv.includes("--help") || argv.includes("-h")) { console.log(PROMOTE_HELP); return; }
  if (argv.includes("--json")) return runJson(() => promoteRun(argv, deps), [{ command: "shipvo doctor --json", why: "Check your setup." }, ...STATUS]);
  await promoteRun(argv, deps);
}

async function promoteRun(argv: string[], deps: { kv?: Store; fetchFn?: typeof fetch }): Promise<Done> {
  checkFlags(argv, PROMOTE_FLAGS);
  const a = parse(argv), cfg = loadConfig();
  const dry = a["dry-run"] !== undefined, force = a.force !== undefined;
  const p = (a.platform || "android").toLowerCase();
  if (p !== "android" && p !== "ios" && p !== "all") throw new UsageError(`--platform must be android, ios or all (got "${a.platform}")`);
  const platforms: Platform[] = p === "all" ? ["android", "ios"] : [p];
  if (a.to === "true") throw new UsageError("--to needs bands: pass --to b1,b2");
  const explicit = a.to ? a.to.split(",").map((s) => s.trim()).filter(Boolean) : null;
  if (explicit) { const bad = explicit.filter((b) => !BANDS.includes(b)); if (bad.length) throw new UsageError(`Unknown band ${bad.join(", ")}. Bands are ${BANDS.join(", ")}.`); }

  if (a.report === "true") throw new UsageError("--report needs a file name: pass --report <file>");
  const reportFile = a.report ?? (existsSync("shipvo-test-report.json") ? "shipvo-test-report.json" : null);

  const APP = cfg.appId, MAJOR = cfg.shellMajor;
  const store = deps.kv ?? kvFor(cfg);

  // Read every source pointer before touching the network or writing anything.
  const plans: { pf: Platform; release: number; from: string; body: Record<string, unknown>; targets: string[]; newer: [string, number][] }[] = [];
  for (const pf of platforms) {
    let from = "", body: Record<string, unknown> | null = null;
    const have = new Map<string, number>();
    for (const band of BANDS) {
      const raw = await store.get(pointerKey(APP, MAJOR, band, pf)); if (!raw) continue;
      try { const b = JSON.parse(JSON.parse(raw).body); have.set(band, b.release); if (!body) { from = band; body = b; } } catch { /* unreadable pointer: skip */ }
    }
    if (!body) throw new CliFailure(`No ${pf} pointer found on any band. Run shipvo publish --bands b0 first.`, "no_pointer", 1, [{ command: "shipvo publish --bands b0 --json", why: "Publish to the first cohort." }]);
    const release = body.release as number;
    if (explicit && explicit.length && explicit.every((b) => b === from)) throw new UsageError(`${from} is the source band (release ${release}). Pass --to with a different band.`);
    // Never write an older release over a newer one: promote widens, it does not downgrade. --force does not change this.
    const cand = (explicit ?? BANDS).filter((b) => b !== from && (explicit || have.get(b) !== release));
    const newer: [string, number][] = cand.filter((b) => (have.get(b) ?? 0) > release).map((b) => [b, have.get(b) as number]);
    const targets = cand.filter((b) => !((have.get(b) ?? 0) > release));
    plans.push({ pf, release, from, body, targets, newer });
  }

  if (reportFile) {
    let rep: { release?: unknown; flows?: { name?: string; status?: string }[] };
    try { rep = JSON.parse(readFileSync(reportFile, "utf8")); } catch (e) { throw new CliFailure(`Could not read the test report ${reportFile} (${e instanceof Error ? e.message : String(e)}).`, "report_unreadable", 1, [{ command: "shipvo test --report shipvo-test-report.json --json", why: "Write a fresh test report." }]); }
    const rel = rep.release == null ? null : String(rep.release);
    const failing = (Array.isArray(rep.flows) ? rep.flows : []).filter((f) => f.status === "failed").map((f) => f.name ?? "(unnamed flow)");
    const mine = plans.filter((x) => String(x.release) === rel);
    if (mine.length && failing.length) {
      const msg = `Test report ${reportFile} has ${failing.length} failing flow${failing.length === 1 ? "" : "s"} for release ${mine[0].release}: ${failing.join(", ")}.`;
      if (!force) throw new CliFailure(`${msg} Fix them and run shipvo test --report again, or pass --force to promote anyway.`, "tests_failed", 1, [{ command: `shipvo test --report ${reportFile} --json`, why: "Run the flows again after the fix." }]);
      console.log(`${msg} Overridden by --force.`);
    } else if (!mine.length) {
      console.log(`Warning: test report ${reportFile} is for ${rel === null ? "no release" : `release ${rel}`}, not release ${plans.map((x) => x.release).join(", ")}. It is stale and was not used.`);
    }
  }

  if (!force) {
    const base = cfg.controlPlane.replace(/\/$/, "");
    let data: Summary;
    try {
      const r = await (deps.fetchFn ?? fetch)(`${base}/t/${encodeURIComponent(APP)}/summary`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = (await r.json()) as Summary;
    } catch (e) {
      throw new CliFailure(`Could not read the release status from ${base} (${e instanceof Error ? e.message : String(e)}). Try again, or pass --force to promote without the check.`, "remote_failed", 1, [{ command: "shipvo doctor --json", why: "Check the control plane." }]);
    }
    for (const { release } of plans) {
      if (data.halted && typeof data.halted === "object" && data.halted.release === release) throw new CliFailure(`Release ${release} is halted. Publish a new release or run shipvo rollback, or pass --force to promote it anyway.`, "blocked", 1, STATUS);
      const ev = data.releases?.find((r) => r.release === release)?.events ?? {};
      const n = REVERT_EVENTS.reduce((s, k) => s + (ev[k] ?? 0), 0);
      if (n > 0) throw new CliFailure(`Release ${release} has ${n} reported revert${n === 1 ? "" : "s"}. Check shipvo status, publish a fix, or pass --force to promote it anyway.`, "blocked", 1, STATUS);
    }
  }

  const result: { platform: Platform; release: number; from: string; bands: string[]; skipped_newer: { band: string; release: number }[] }[] = [];
  for (const { pf, release, from, body, targets, newer } of plans) {
    result.push({ platform: pf, release, from, bands: targets, skipped_newer: newer.map(([band, release]) => ({ band, release })) });
    for (const [b, r] of newer) console.log(`Skipped ${b} (${pf}): it already has release ${r}, which is newer than ${release}.`);
    if (!targets.length && newer.length) { console.log(`Nothing to promote: every other band already has a newer release than ${release} (${pf}).`); continue; }
    if (!targets.length) { console.log(`Nothing to promote: release ${release} (${pf}) already has a pointer on every band.`); continue; }
    const issued_at = new Date().toISOString();
    for (const band of targets) {
      if (dry) { console.log(`Would write ${band} (${pf}): release ${release}, copied from ${from}`); continue; }
      const text = JSON.stringify({ ...body, band, issued_at });
      await store.put(pointerKey(APP, MAJOR, band, pf), JSON.stringify({ body: text, signature: signBytes(new TextEncoder().encode(text), seed()) }), "application/json");
      console.log(`Wrote ${band} (${pf}): release ${release}, copied from ${from}`);
    }
  }
  if (dry) console.log("Dry run: nothing was written.");
  const count = result.reduce((n, r) => n + r.bands.length, 0);
  const data = { dry_run: dry, promoted: result };
  if (count === 0) return { code: "nothing_to_promote", summary: "Nothing to promote: no band needs this release.", data, next: STATUS };
  const list = result.map((r) => `${r.platform} release ${r.release} to ${r.bands.join(", ")}`).join("; ");
  if (dry) return { code: "dry_run", summary: `Would promote ${list}. Nothing was written.`, data, next: [{ command: `shipvo promote ${argv.filter((x) => x !== "--dry-run").join(" ")}`.trim(), why: "Do the promote." }] };
  return { code: "promoted", summary: `Promoted ${list}.`, data, next: STATUS };
}
