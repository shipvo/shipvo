// `shipvo promote`: widen a staged release to more bands. Reads the pointer on the narrowest band that has one,
// and writes the same release (same bundle, hashes and patches) to the other bands with a fresh issued_at and signature.
import { signBytes } from "./index.js";
import { args as parse, kv as kvFor, loadConfig, seed } from "./config.js";

const BANDS = ["b0", "b1", "b2"];
const REVERT_EVENTS = ["rolled_back", "crash_loop_revert"];
type Platform = "android" | "ios";
type Store = Pick<ReturnType<typeof kvFor>, "get" | "put">;
type Summary = { releases?: { release: number; events?: Record<string, number> }[]; halted?: { release: number } | null };

const pointerKey = (app: string, major: number, band: string, pf: Platform) => (pf === "ios" ? `p/${app}/${major}/ios/${band}` : `p/${app}/${major}/${band}`);

export const PROMOTE_FLAGS = ["to", "platform", "dry-run", "force"];

export const PROMOTE_HELP = `Usage: shipvo promote [flags]

Widen a staged release to more bands. The release number, bundle and patches stay the same; the pointer is signed again.

Flags (write a value after a space, not =):
  --to b1,b2                   Bands to write (default: every band with no pointer for this release)
  --platform android|ios|all   Platform to promote (default android)
  --dry-run                    Print the plan, write nothing
  --force                      Promote even if the release is halted or has reverts
  --help                       Show this help
`;

function checkFlags(argv: string[], known: string[]) {
  const bad = argv.filter((x) => x.startsWith("--") && !known.includes(x.slice(2)));
  if (bad.length) {
    const eq = bad.find((x) => x.includes("="));
    const hint = eq ? ` Write "${eq.replace("=", " ")}" (a space, not =).` : "";
    throw new Error(`Unknown flag ${bad.join(", ")}.${hint} Known flags: ${known.map((k) => "--" + k).join(" ")}`);
  }
}

export async function promote(argv: string[], deps: { kv?: Store; fetchFn?: typeof fetch } = {}) {
  if (argv.includes("--help") || argv.includes("-h")) { console.log(PROMOTE_HELP); return; }
  checkFlags(argv, PROMOTE_FLAGS);
  const a = parse(argv), cfg = loadConfig();
  const dry = a["dry-run"] !== undefined, force = a.force !== undefined;
  const p = (a.platform || "android").toLowerCase();
  if (p !== "android" && p !== "ios" && p !== "all") throw new Error(`--platform must be android, ios or all (got "${a.platform}")`);
  const platforms: Platform[] = p === "all" ? ["android", "ios"] : [p];
  if (a.to === "true") throw new Error("--to needs bands: pass --to b1,b2");
  const explicit = a.to ? a.to.split(",").map((s) => s.trim()).filter(Boolean) : null;
  if (explicit) { const bad = explicit.filter((b) => !BANDS.includes(b)); if (bad.length) throw new Error(`Unknown band ${bad.join(", ")}. Bands are ${BANDS.join(", ")}.`); }

  const APP = cfg.appId, MAJOR = cfg.shellMajor;
  const store = deps.kv ?? kvFor(cfg);

  // Read every source pointer before touching the network or writing anything.
  const plans: { pf: Platform; release: number; from: string; body: Record<string, unknown>; targets: string[] }[] = [];
  for (const pf of platforms) {
    let from = "", body: Record<string, unknown> | null = null;
    const have = new Map<string, number>();
    for (const band of BANDS) {
      const raw = await store.get(pointerKey(APP, MAJOR, band, pf)); if (!raw) continue;
      try { const b = JSON.parse(JSON.parse(raw).body); have.set(band, b.release); if (!body) { from = band; body = b; } } catch { /* unreadable pointer: skip */ }
    }
    if (!body) throw new Error(`No ${pf} pointer found on any band. Run shipvo publish --bands b0 first.`);
    const release = body.release as number;
    const targets = (explicit ?? BANDS).filter((b) => b !== from && (explicit || have.get(b) !== release));
    plans.push({ pf, release, from, body, targets });
  }

  if (!force) {
    const base = cfg.controlPlane.replace(/\/$/, "");
    let data: Summary;
    try {
      const r = await (deps.fetchFn ?? fetch)(`${base}/t/${encodeURIComponent(APP)}/summary`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = (await r.json()) as Summary;
    } catch (e) {
      throw new Error(`Could not read the release status from ${base} (${e instanceof Error ? e.message : String(e)}). Try again, or pass --force to promote without the check.`);
    }
    for (const { release } of plans) {
      if (data.halted && typeof data.halted === "object" && data.halted.release === release) throw new Error(`Release ${release} is halted. Publish a new release or run shipvo rollback, or pass --force to promote it anyway.`);
      const ev = data.releases?.find((r) => r.release === release)?.events ?? {};
      const n = REVERT_EVENTS.reduce((s, k) => s + (ev[k] ?? 0), 0);
      if (n > 0) throw new Error(`Release ${release} has ${n} reported revert${n === 1 ? "" : "s"}. Check shipvo status, publish a fix, or pass --force to promote it anyway.`);
    }
  }

  for (const { pf, release, from, body, targets } of plans) {
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
}
