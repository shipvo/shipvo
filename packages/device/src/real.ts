// Real browser hardware for the web/simulator layer, used only when a person is there to grant it.
// Every function returns null when real hardware cannot or should not be used, so the caller falls back to the
// simulated device. None of them prompt or wait forever in headless runs.
import type { Coords } from "./types";

export type Source = "real" | "simulated";
/** The browser objects we read. Passed in so tests can fake them. */
export type Env = { navigator?: any; document?: any };

const TIMEOUT_MS = 15000;
const defaultEnv = (): Env => ({ navigator: (globalThis as any).navigator, document: (globalThis as any).document });

/** True when no person is looking at this page: automation, headless Chrome, or a hidden tab. */
export function isHeadless(env: Env = defaultEnv()): boolean {
  const n = env.navigator, d = env.document;
  if (!n || !d) return true;
  if (n.webdriver === true) return true;
  if (/HeadlessChrome|Headless/i.test(String(n.userAgent ?? ""))) return true;
  return d.visibilityState !== undefined && d.visibilityState !== "visible";
}

/** Whether real hardware may be tried at all. `mode: "simulated"` forces the simulated device for reproducible runs. */
export const mayUseReal = (mode: "auto" | "simulated" | undefined, env: Env = defaultEnv()) => mode !== "simulated" && !isHeadless(env);

const withTimeout = <T>(work: Promise<T>, ms: number, onLate?: (v: T) => void): Promise<T | null> =>
  new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { done = true; resolve(null); }, ms);
    work.then((v) => { clearTimeout(t); if (done) onLate?.(v); else resolve(v); }, () => { clearTimeout(t); if (!done) resolve(null); });
  });

/** Opens a real media stream, or null when the API is missing, permission is refused or nothing answers in time. */
export async function openStream(constraints: { video?: unknown; audio?: unknown }, env: Env = defaultEnv(), timeoutMs = TIMEOUT_MS): Promise<any | null> {
  const md = env.navigator?.mediaDevices;
  if (typeof md?.getUserMedia !== "function") return null;
  try { return await withTimeout(Promise.resolve(md.getUserMedia(constraints)), timeoutMs, (s: any) => stopStream(s)); } catch { return null; }
}
export const stopStream = (s: any) => { try { s?.getTracks?.().forEach((t: any) => t.stop()); } catch { /* already stopped */ } };

/** The browser's current position, or null when geolocation is missing, refused or too slow. */
export async function realPosition(env: Env = defaultEnv(), timeoutMs = TIMEOUT_MS): Promise<Coords | null> {
  const geo = env.navigator?.geolocation;
  if (typeof geo?.getCurrentPosition !== "function") return null;
  return withTimeout(new Promise<Coords>((ok, no) => {
    try { geo.getCurrentPosition((pos: any) => ok({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy ?? undefined }), no, { timeout: timeoutMs }); } catch (e) { no(e); }
  }), timeoutMs + 1000);
}

/** A BarcodeDetector for common code types, or null when the browser has none. */
export function barcodeDetector(g: any = globalThis): { detect(src: unknown): Promise<{ format: string; rawValue: string }[]> } | null {
  if (typeof g.BarcodeDetector !== "function") return null;
  try { return new g.BarcodeDetector(); } catch { return null; }
}
