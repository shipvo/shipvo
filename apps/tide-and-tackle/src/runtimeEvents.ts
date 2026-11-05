/** Runtime events the app forwards to telemetry. Each one is sent once per event. */
export const FORWARDED_EVENTS = ["crash_loop_revert", "rolled_back", "verify_failed", "download_failed"] as const;
export type ForwardedEvent = (typeof FORWARDED_EVENTS)[number];

/**
 * Turn runtime event strings ("name" or "name:<release>") into telemetry reports.
 * `release` is the id in the event when it has one, so a failed release is reported
 * under its own id. Otherwise it is left to the sender (the running release).
 */
export function forwardRuntimeEvents(
  events: string[],
  send: (event: ForwardedEvent, release?: number) => void,
): void {
  for (const e of events) {
    const [name, id] = e.split(":");
    if (!(FORWARDED_EVENTS as readonly string[]).includes(name)) continue;
    const release = id !== undefined && /^\d+$/.test(id) ? Number(id) : undefined;
    send(name as ForwardedEvent, release);
  }
}
