// `shipvo ci shots`: one simulator screenshot per changed screen, written to shipvo-shots/ for the check comment.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { changedFiles, changedScreens } from "./ci-comment.js";

const MAX = 4;

/** Route for a screen name from `changedScreens`. Dynamic screens (`[id]`) and layouts are skipped. */
export function screenRoute(name: string): string | null {
  if (/\[|\(|(?:^|\/)_/.test(name) || name === "+not-found") return null;
  return name === "home" ? "/" : `/${name}`;
}

/** The screens to capture or walk: routable ones only, first four. Shared by `ci shots` and `explore --changed-from`. */
export function routableScreens(screens: string[]): (readonly [string, string])[] {
  return screens.map((s) => [s, screenRoute(s)] as const).filter((r): r is readonly [string, string] => r[1] !== null).slice(0, MAX);
}

export type Shoot = (route: string) => Promise<Uint8Array>;

/** Capture up to four screens. A screen that fails is reported and skipped. Returns the files written. */
export async function captureScreens(screens: string[], shoot: Shoot, outDir: string, log: (s: string) => void = console.log): Promise<string[]> {
  const written: string[] = [];
  const routes = routableScreens(screens);
  if (!routes.length) return written;
  mkdirSync(outDir, { recursive: true });
  for (const [name, route] of routes) {
    try {
      const file = join(outDir, `${name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "screen"}.png`);
      writeFileSync(file, await shoot(route));
      written.push(file);
    } catch (e) { log(`screenshot of ${name} skipped: ${e instanceof Error ? e.message : e}`); }
  }
  return written;
}

/** `shipvo ci shots --changed-from <sha> [--sim url] [--out dir]`. Never fails the check. */
export async function shotsCmd(argv: string[]): Promise<number> {
  const val = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const base = val("--changed-from"), sim = (val("--sim") ?? "http://localhost:4545").replace(/\/$/, ""), out = val("--out") ?? "shipvo-shots";
  if (!base) { console.error("shipvo ci shots: --changed-from <sha> is required"); return 2; }
  let screens: string[] = [];
  try { screens = changedScreens(changedFiles(base)); } catch (e) { console.error(`could not read the diff: ${e instanceof Error ? e.message : e}`); return 0; }
  const post = async (path: string, body: Record<string, unknown>) => {
    const r = await fetch(sim + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`simulator ${path} -> ${r.status}`);
    return (await r.json()) as { ok?: boolean; error?: string; data?: string };
  };
  const { loadConfig } = await import("./config.js");
  let appId: string;
  try { appId = loadConfig().appId; } catch (e) { console.error(`could not read shipvo.json: ${e instanceof Error ? e.message : e}`); return 0; }
  const session = `ci-shots-${Date.now().toString(36)}`;
  const files = await captureScreens(screens, async (route) => {
    const open = await post("/session", { session, app: appId, width: 390, height: 844 });
    if (open.ok === false) throw new Error(`could not open the app: ${open.error ?? "unknown error"}`);
    const nav = await post("/act", { session, action: "open_url", url: route });
    if (!nav.ok) throw new Error(`could not open ${route}: ${nav.error ?? "unknown error"}`);
    const shot = await post("/act", { session, action: "screenshot", format: "png", inline: true });
    if (!shot.ok || !shot.data) throw new Error(`screenshot failed: ${shot.error ?? "no data"}`);
    return new Uint8Array(Buffer.from(shot.data, "base64"));
  }, out, (s) => console.error(s));
  console.log(`Captured ${files.length} screenshot${files.length === 1 ? "" : "s"} in ${out}/.`);
  return 0;
}
