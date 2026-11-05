/** Runtime events the app forwards to telemetry. Each one is sent once per event. */
export const FORWARDED_EVENTS = ["crash_loop_revert", "rolled_back", "verify_failed", "download_failed", "bytecode_mismatch"] as const;
export type ForwardedEvent = (typeof FORWARDED_EVENTS)[number];

const CARRIES_RELEASE: string[] = ["verify_failed", "download_failed", "bytecode_mismatch"];

/**
 * Turn runtime event strings ("name" or "name:<release>") into telemetry reports.
 * `verify_failed`, `download_failed` and `bytecode_mismatch` carry a release id: a failed release is
 * reported under its own id. `crash_loop_revert` and `rolled_back` never override the
 * release, so the sender uses the running release as before. A missing or non-numeric
 * id also falls back to the running release.
 */
export function forwardRuntimeEvents(
  events: string[],
  send: (event: ForwardedEvent, release?: number) => void,
): void {
  for (const e of events) {
    const [name, id] = e.split(":");
    if (!(FORWARDED_EVENTS as readonly string[]).includes(name)) continue;
    const release = CARRIES_RELEASE.includes(name) && id !== undefined && /^\d+$/.test(id) ? Number(id) : undefined;
    send(name as ForwardedEvent, release);
  }
}
