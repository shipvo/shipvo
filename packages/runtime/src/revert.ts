/** A release the device still holds that automatic revert could go back to. `stateVersion` 0 = none declared. */
export type RevertCandidate = { release: number; stateVersion: number };

/**
 * Where a crash-loop revert goes: the newest release below `failing` whose state version is not lower than the
 * device's own (`deviceStateVersion`). Returns null when none qualifies; the device then runs its embedded bundle.
 * A release that declares nothing counts as 0, so it is only eligible when the device has no declared version either.
 */
export function pickRevertTarget(candidates: RevertCandidate[], failing: number, deviceStateVersion: number): RevertCandidate | null {
  const eligible = candidates
    .filter((c) => c.release < failing && c.stateVersion >= deviceStateVersion)
    .sort((a, b) => b.release - a.release);
  return eligible[0] ?? null;
}
