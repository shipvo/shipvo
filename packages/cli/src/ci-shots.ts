// `shipvo ci shots`: one simulator screenshot per changed screen, written to shipvo-shots/ for the check comment.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { changedFiles, changedScreens } from "./ci-comment.js";

const MAX = 4;
/** Most screens shown before and after in the comment. */
export const MAX_COMPARE = 6;
export const SKINS = ["android", "ios"] as const;
export type SkinName = (typeof SKINS)[number];

/** Route for a screen name from `changedScreens`. Dynamic screens (`[id]`) and layouts are skipped. */
export function screenRoute(name: string): string | null {
  if (/\[|\(|(?:^|\/)_/.test(name) || name === "+not-found") return null;
  return name === "home" ? "/" : `/${name}`;
}

/** The screens to capture or walk: routable ones only, first four. Shared by `ci shots` and `explore --changed-from`. */
export function routableScreens(screens: string[], max = MAX): (readonly [string, string])[] {
  return screens.map((s) => [s, screenRoute(s)] as const).filter((r): r is readonly [string, string] => r[1] !== null).slice(0, max);
}

export type Shoot = (route: string, skin?: SkinName) => Promise<Uint8Array>;

export const shotFile = (name: string, skin?: SkinName) => `${name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "screen"}${skin ? `.${skin}` : ""}.png`;

/** Capture screens (first four, or `max`). With `skins`, each screen is shot once per skin as `<screen>.<skin>.png`. A shot that fails is reported and skipped. Returns the files written. */
export async function captureScreens(screens: string[], shoot: Shoot, outDir: string, log: (s: string) => void = console.log, o: { skins?: readonly SkinName[]; max?: number } = {}): Promise<string[]> {
  const written: string[] = [];
  const routes = routableScreens(screens, o.max);
  if (!routes.length) return written;
  mkdirSync(outDir, { recursive: true });
  for (const [name, route] of routes) {
    for (const skin of o.skins ?? [undefined]) {
      try {
        const file = join(outDir, shotFile(name, skin));
        writeFileSync(file, await shoot(route, skin));
        written.push(file);
      } catch (e) { log(`screenshot of ${name}${skin ? ` (${skin})` : ""} skipped: ${e instanceof Error ? e.message : e}`); }
    }
  }
  return written;
}

/** `shipvo ci shots --changed-from <sha> [--sim url] [--out dir] [--skins android,ios] [--screens-file f]`. Never fails the check.
 * With `--skins` it shoots each changed screen on those skins (light theme, 390x844) and writes the screen list to `<out>/screens.json`.
 * `--screens-file` reads that list instead of the git diff, so the base build can be shot with the same screens. */
export async function shotsCmd(argv: string[]): Promise<number> {
  const val = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const base = val("--changed-from"), sim = (val("--sim") ?? "http://localhost:4545").replace(/\/$/, ""), out = val("--out") ?? "shipvo-shots";
  const skinArg = val("--skins"), screensFile = val("--screens-file");
  const skins = skinArg ? (skinArg.split(",").filter((k): k is SkinName => (SKINS as readonly string[]).includes(k))) : undefined;
  if (!base && !screensFile) { console.error("shipvo ci shots: --changed-from <sha> is required"); return 2; }
  let screens: string[] = [];
  try { screens = screensFile ? (JSON.parse(readFileSync(screensFile, "utf8")) as string[]) : changedScreens(changedFiles(base!)); } catch (e) { console.error(`could not read the diff: ${e instanceof Error ? e.message : e}`); return 0; }
  const post = async (path: string, body: Record<string, unknown>) => {
    const r = await fetch(sim + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`simulator ${path} -> ${r.status}`);
    return (await r.json()) as { ok?: boolean; error?: string; data?: string };
  };
  const { loadConfig } = await import("./config.js");
  let appId: string;
  try { appId = loadConfig().appId; } catch (e) { console.error(`could not read shipvo.json: ${e instanceof Error ? e.message : e}`); return 0; }
  if (skins) {
    mkdirSync(out, { recursive: true });
    if (!screensFile) writeFileSync(join(out, "screens.json"), JSON.stringify(screens));
  }
  const session = `ci-shots-${Date.now().toString(36)}`;
  const files = await captureScreens(screens, async (route, skin) => {
    const open = await post("/session", { session: skin ? `${session}-${skin}` : session, app: appId, width: 390, height: 844, ...(skin ? { device: { platform: skin } } : {}) });
    if (open.ok === false) throw new Error(`could not open the app: ${open.error ?? "unknown error"}`);
    const nav = await post("/act", { session: skin ? `${session}-${skin}` : session, action: "open_url", url: route });
    if (!nav.ok) throw new Error(`could not open ${route}: ${nav.error ?? "unknown error"}`);
    const shot = await post("/act", { session: skin ? `${session}-${skin}` : session, action: "screenshot", format: "png", inline: true });
    if (!shot.ok || !shot.data) throw new Error(`screenshot failed: ${shot.error ?? "no data"}`);
    return new Uint8Array(Buffer.from(shot.data, "base64"));
  }, out, (s) => console.error(s), skins ? { skins, max: MAX_COMPARE } : {});
  console.log(`Captured ${files.length} screenshot${files.length === 1 ? "" : "s"} in ${out}/.`);
  return 0;
}
