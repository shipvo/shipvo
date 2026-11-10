/** Runtime events the app forwards to telemetry. Each one is sent once per event. */
export const FORWARDED_EVENTS = [
  "crash_loop_revert",
  "rolled_back",
  "verify_failed",
  "download_failed",
  "hermes_bytecode_mismatch",
  "native_module_missing",
  "native_module_version",
] as const;
export type ForwardedEvent = (typeof FORWARDED_EVENTS)[number];

const CARRIES_RELEASE: string[] = ["verify_failed", "download_failed", "hermes_bytecode_mismatch"];
const NATIVE_MODULE_REASONS: string[] = ["native_module_missing", "native_module_version"];

/**
 * Turn runtime event strings ("name" or "name:<release>") into telemetry reports.
 * `verify_failed`, `download_failed` and `hermes_bytecode_mismatch:<release>:...`
 * carry a release id: a failed release is reported under its own id. `crash_loop_revert` and `rolled_back` never override the
 * release, so the sender uses the running release as before. A missing or non-numeric
 * id also falls back to the running release.
 */
export function forwardRuntimeEvents(
  events: string[],
  send: (event: ForwardedEvent, release?: number, extra?: { state_version_from?: number; state_version_to?: number }) => void,
): void {
  for (const e of events) {
    const [name, id] = e.split(":");
    if (name === "pointer_rejected") {
      // "pointer_rejected:<reason>": only the two native-module reasons are reported.
      if (id !== undefined && NATIVE_MODULE_REASONS.includes(id)) send(id as ForwardedEvent);
      continue;
    }
    if (!(FORWARDED_EVENTS as readonly string[]).includes(name)) continue;
    const release = CARRIES_RELEASE.includes(name) && id !== undefined && /^\d+$/.test(id) ? Number(id) : undefined;
    // "crash_loop_revert:<release>:<state_version_from>:<state_version_to>"; a 0 or missing part means no declaration.
    if (name === "crash_loop_revert") {
      const [, , from, to] = e.split(":");
      const pos = (x?: string) => (x !== undefined && /^\d+$/.test(x) && Number(x) > 0 ? Number(x) : undefined);
      const extra = { ...(pos(from) ? { state_version_from: pos(from) } : {}), ...(pos(to) ? { state_version_to: pos(to) } : {}) };
      send(name, undefined, Object.keys(extra).length ? extra : undefined);
      continue;
    }
    send(name as ForwardedEvent, release);
  }
}
