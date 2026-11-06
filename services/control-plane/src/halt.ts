export type ReleaseCounts = { healthy: number; failed: number };

export const FAILED_EVENTS: readonly string[] = ["rolled_back", "crash_loop_revert", "verify_failed", "download_failed"];
export const HEALTHY_EVENTS: readonly string[] = ["applied", "content_applied"];

export const DEFAULT_MIN_REPORTS = 20;
export const DEFAULT_MIN_INSTALLS = 20;
/** Failures must come from at least this many distinct networks (salted /24 or /48 hashes). Not configurable. */
export const MIN_NETWORKS = 3;

/** One verified install's state for one release. */
export type InstallVote = { install_id: string; net_hash: string | null; failed: boolean; healthy: boolean; created_at?: string | null };

/**
 * One vote per install: an install that reported any failure votes failed, otherwise healthy if it reported healthy.
 * Only verified rows should be passed in.
 */
export function tallyVotes(votes: InstallVote[]): ReleaseCounts & { installs: number; failedNetworks: number } {
  const seen = new Map<string, InstallVote>();
  for (const v of votes) {
    const o = seen.get(v.install_id);
    seen.set(v.install_id, o ? { ...o, failed: o.failed || v.failed, healthy: o.healthy || v.healthy, net_hash: o.net_hash ?? v.net_hash, created_at: o.created_at ?? v.created_at } : v);
  }
  let healthy = 0, failed = 0;
  const nets = new Set<string>();
  for (const v of seen.values()) {
    if (v.failed) { failed++; if (v.net_hash) nets.add(v.net_hash); }
    else if (v.healthy) healthy++;
  }
  return { healthy, failed, installs: healthy + failed, failedNetworks: nets.size };
}

export function shouldHalt(
  counts: ReleaseCounts & { installs?: number; failedNetworks?: number },
  opts: { threshold?: number; minReports: number; minInstalls?: number; minNetworks?: number },
): { halt: boolean; reports: number; failureShare: number } {
  const reports = counts.healthy + counts.failed;
  const failureShare = reports > 0 ? counts.failed / reports : 0;
  const t = opts.threshold;
  const valid = typeof t === "number" && t > 0 && t <= 1;
  // Callers that pass no install or network data (plain counts) skip the corroboration checks.
  const installsOk = counts.installs === undefined || counts.installs >= (opts.minInstalls ?? DEFAULT_MIN_INSTALLS);
  const netsOk = counts.failedNetworks === undefined || counts.failedNetworks >= (opts.minNetworks ?? MIN_NETWORKS);
  const halt = valid && reports > 0 && reports >= opts.minReports && installsOk && netsOk && failureShare > t;
  return { halt, reports, failureShare };
}

/** Anomaly guard: a halt that looks like an attack is held for the owner instead. */
export const FRESH_INSTALL_WINDOW_MS = 60 * 60 * 1000;
/** Hold when more than this share of failing installs registered inside the fresh-install window. */
export const FRESH_INSTALL_SHARE = 0.5;
/** Failure-rate window, in minutes, for the spike check. */
export const SPIKE_WINDOW_MINUTES = 10;
/** The baseline is the app's failure reports over this many hours before the spike window. */
export const SPIKE_BASELINE_HOURS = 24;
/** Hold when failures in the window are at least this many times the baseline for one window... */
export const SPIKE_FACTOR = 5;
/** ...and at least this many in absolute terms, so a quiet app is not held on three reports. */
export const SPIKE_MIN_FAILURES = 20;
/** Command name of the owner approval entry the guard creates. */
export const ANOMALY_COMMAND = "anomaly_hold";

/** Share of failing installs that registered within the fresh-install window. Installs with no known registration time count as established. */
export function freshFailureShare(votes: InstallVote[], now: number): number {
  const failing = new Map<string, InstallVote>();
  for (const v of votes) if (v.failed && !failing.has(v.install_id)) failing.set(v.install_id, v);
  if (failing.size === 0) return 0;
  let fresh = 0;
  for (const v of failing.values()) { const t = v.created_at ? Date.parse(v.created_at) : NaN; if (Number.isFinite(t) && now - t <= FRESH_INSTALL_WINDOW_MS) fresh++; }
  return fresh / failing.size;
}

/** Why a halt should be held for the owner, or null when it looks normal. `recent` is failures in the spike window, `baseline` in the baseline period before it. */
export function anomalyReason(votes: InstallVote[], rate: { recent: number; baseline: number } | null, now: number): string | null {
  const share = freshFailureShare(votes, now);
  if (share > FRESH_INSTALL_SHARE) return `${Math.round(share * 100)}% of failing installs registered in the last hour`;
  if (rate) {
    const windows = (SPIKE_BASELINE_HOURS * 60) / SPIKE_WINDOW_MINUTES;
    const perWindow = Math.max(1, rate.baseline / windows);
    if (rate.recent >= SPIKE_MIN_FAILURES && rate.recent > SPIKE_FACTOR * perWindow) return `${rate.recent} failure reports in ${SPIKE_WINDOW_MINUTES} minutes, far above the usual rate`;
  }
  return null;
}
