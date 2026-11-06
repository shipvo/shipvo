// Messages on the `shipvo run` agent channel (`/__shipvo/agent`). The host only relays them between the
// `screen` (the browser tab) and the `driver` (the agent). Slices 2 and 3 of #448 build on these types.
import { timingSafeEqual } from "node:crypto";

export const AGENT_PATH = "/__shipvo/agent";
export type AgentRole = "screen" | "driver";

/** Contents of `.shipvo/run.json` while `shipvo run` is up. */
export type RunInfo = { port: number; platform: "android" | "ios"; app: string; token: string; pid: number };

/** Driver to screen: ask the page to do something. `id` pairs the reply with the request. */
export type DriverMessage = { id: number; type: string; [key: string]: unknown };
/** Screen to driver: the reply to `id`, or an event the page pushes on its own (no `id`). */
export type ScreenMessage = { id?: number; type: string; ok?: boolean; error?: string; [key: string]: unknown };
export type AgentMessage = DriverMessage | ScreenMessage;

export const isAgentRole = (v: string | null): v is AgentRole => v === "screen" || v === "driver";

export function isLoopback(addr: string | undefined): boolean {
  return addr === "127.0.0.1" || addr === "::1" || (addr?.startsWith("::ffff:127.") ?? false);
}

/** True when the `Host` header names this server on loopback. Blocks DNS rebinding. */
export function hostAllowed(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/** True when there is no `Origin` (not a browser) or it is this server's own origin. */
export function originAllowed(origin: string | undefined, port: number): boolean {
  return origin === undefined || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

export function tokenMatches(given: string | null, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
