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

/** "Most" failing installs: more than this share registered within the fresh window. */
export const FRESH_INSTALL_SHARE = 0.5;
/** An install is fresh if it registered within this many milliseconds (one hour). */
export const FRESH_INSTALL_WINDOW_MS = 60 * 60 * 1000;
/** Recent failures are a burst when they exceed the normal rate by this factor. */
export const BURST_FACTOR = 5;
/** Failures needed in the last 10 minutes before a burst counts, so tiny numbers never trigger it. */
export const BURST_MIN_REPORTS = 10;

export type AttackInput = {
  /** Failing installs with their registration time (ms since epoch). */
  failingInstalls: { install_id: string; registered_at: number }[];
  /** Failure reports in the last 10 minutes. */
  recentReports: number;
  /** The app's normal failure reports per 10 minutes; 0 or undefined when there is no history. */
  normalRate?: number;
  /** Current time in ms; defaults to Date.now(). */
  now?: number;
};

/** Pure check: do the failures look like fake fresh installs or a sudden burst? */
export function looksLikeAttack(input: AttackInput): { suspicious: boolean; reason: "fresh_installs" | "burst" | null } {
  const now = input.now ?? Date.now();
  const list = input.failingInstalls;
  if (list.length > 0) {
    // A registered_at in the future gives a negative age and counts as fresh.
    const fresh = list.filter((i) => now - i.registered_at <= FRESH_INSTALL_WINDOW_MS).length;
    if (fresh / list.length > FRESH_INSTALL_SHARE) return { suspicious: true, reason: "fresh_installs" };
  }
  const rate = input.normalRate ?? 0;
  if (rate > 0 && input.recentReports >= BURST_MIN_REPORTS && input.recentReports > rate * BURST_FACTOR) {
    return { suspicious: true, reason: "burst" };
  }
  return { suspicious: false, reason: null };
}
