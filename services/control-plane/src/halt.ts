export type ReleaseCounts = { healthy: number; failed: number };

export const FAILED_EVENTS: readonly string[] = ["rolled_back", "crash_loop_revert", "verify_failed", "download_failed"];
export const HEALTHY_EVENTS: readonly string[] = ["applied", "content_applied"];

export function shouldHalt(
  counts: ReleaseCounts,
  opts: { threshold?: number; minReports: number },
): { halt: boolean; reports: number; failureShare: number } {
  const reports = counts.healthy + counts.failed;
  const failureShare = reports > 0 ? counts.failed / reports : 0;
  const t = opts.threshold;
  const valid = typeof t === "number" && t > 0 && t <= 1;
  const halt = valid && reports > 0 && reports >= opts.minReports && failureShare > t;
  return { halt, reports, failureShare };
}
