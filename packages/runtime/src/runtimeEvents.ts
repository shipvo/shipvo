/** Runtime events the app forwards to telemetry. Each one is sent once per event. */
export const FORWARDED_EVENTS = [
  "crash_loop_revert",
  "rolled_back",
  "verify_failed",
  "download_failed",
  "hermes_bytecode_mismatch",
  "native_module_missing",
  "native_module_version",
  "js_crash_cold",
  "js_crash_reload",
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
  send: (event: ForwardedEvent, release?: number) => void,
): void {
  for (const e of events) {
    const [name, id] = e.split(":");
    if (name === "pointer_rejected") {
      // "pointer_rejected:<reason>": only the two native-module reasons are reported.
      if (id !== undefined && NATIVE_MODULE_REASONS.includes(id)) send(id as ForwardedEvent);
      continue;
    }
    if (name === "js_crash") {
      // "js_crash:<cold|reload>": an uncaught JS error, with the kind of load it happened in.
      if (id === "cold" || id === "reload") send(`js_crash_${id}`);
      continue;
    }
    if (!(FORWARDED_EVENTS as readonly string[]).includes(name)) continue;
    const release = CARRIES_RELEASE.includes(name) && id !== undefined && /^\d+$/.test(id) ? Number(id) : undefined;
    send(name as ForwardedEvent, release);
  }
}
