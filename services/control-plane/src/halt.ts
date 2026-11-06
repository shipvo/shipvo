export type ReleaseCounts = { healthy: number; failed: number };

export const FAILED_EVENTS: readonly string[] = ["rolled_back", "crash_loop_revert", "verify_failed", "download_failed"];
export const HEALTHY_EVENTS: readonly string[] = ["applied", "content_applied"];

export const DEFAULT_MIN_REPORTS = 20;
export const DEFAULT_MIN_INSTALLS = 20;
/** Failures must come from at least this many distinct networks (salted /24 or /48 hashes). Not configurable. */
export const MIN_NETWORKS = 3;

/** One verified install's state for one release. */
export type InstallVote = { install_id: string; net_hash: string | null; failed: boolean; healthy: boolean };

/**
 * One vote per install: an install that reported any failure votes failed, otherwise healthy if it reported healthy.
 * Only verified rows should be passed in.
 */
export function tallyVotes(votes: InstallVote[]): ReleaseCounts & { installs: number; failedNetworks: number } {
  const seen = new Map<string, InstallVote>();
  for (const v of votes) {
    const o = seen.get(v.install_id);
    seen.set(v.install_id, o ? { ...o, failed: o.failed || v.failed, healthy: o.healthy || v.healthy, net_hash: o.net_hash ?? v.net_hash } : v);
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

/** A failing install counts as fresh if it registered within this window. */
export const FRESH_WINDOW_MS = 3600_000;
/** If at least this share of failing installs is fresh, the failures look manufactured. */
export const FRESH_SHARE = 0.5;
/** The "jump" window, in minutes, and how many times the app's normal rate in that window counts as far above. */
export const SPIKE_WINDOW_MIN = 10;
export const SPIKE_FACTOR = 5;
/** Fewer verified failures than this inside the window is never a spike. */
export const SPIKE_FLOOR = 10;
/** The spike rule needs this much verified history older than a day, or there is no "normal" to compare with. */
export const SPIKE_MIN_HISTORY = 20;

export type AnomalyInput = {
  failedInstalls: number;
  /** Failing installs that registered inside FRESH_WINDOW_MS. */
  freshFailedInstalls: number;
  /** Verified failure reports (any release) in the last SPIKE_WINDOW_MIN minutes. */
  recentFailures: number;
  /** Verified failure reports for the app over the previous 7 days, before that window. Null if unknown. */
  baselineFailures: number | null;
  /** Verified reports older than one day, as a measure of how much history there is. */
  history: number;
};

/** Does a halt verdict look attacked? Returns the reason, or null. A held release is not halted: the owner decides. */
export function detectAnomaly(i: AnomalyInput): string | null {
  if (i.failedInstalls > 0 && i.freshFailedInstalls / i.failedInstalls >= FRESH_SHARE) {
    return `${i.freshFailedInstalls} of ${i.failedInstalls} failing installs registered in the last hour`;
  }
  if (i.baselineFailures !== null && i.history >= SPIKE_MIN_HISTORY && i.recentFailures >= SPIKE_FLOOR) {
    const windows = (7 * 24 * 60) / SPIKE_WINDOW_MIN;
    const normal = Math.max(i.baselineFailures / windows, 0.5);
    if (i.recentFailures >= normal * SPIKE_FACTOR) return `${i.recentFailures} failures in ${SPIKE_WINDOW_MIN} minutes, against a normal ${normal.toFixed(1)}`;
  }
  return null;
}
