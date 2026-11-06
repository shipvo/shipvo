// `shipvo ci shots`: one simulator screenshot per changed screen, written to shipvo-shots/ for the check comment.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { changedFiles, changedScreens } from "./ci-comment.js";
import { runJson, UsageError } from "./json-out.js";

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

export const SKINS = ["android", "ios"] as const;
export type Skin = (typeof SKINS)[number];
/** One screen on one skin. `before` and `after` are paths relative to their own directory; a missing side is left out. */
export type ShotPair = { screen: string; skin: Skin; before?: string; after?: string; changed: boolean };
export const MAX_PAIRS = 6;

/** Every file under `<dir>/<skin>`, as normalised paths relative to `<dir>` (forward slashes, no leading `./`). */
function listSkin(dir: string, skin: Skin): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = join(dir, ...rel.split("/"));
    if (!existsSync(abs)) return;
    for (const name of readdirSync(abs).sort()) {
      const r = posix.join(rel, name);
      if (statSync(join(dir, ...r.split("/"))).isDirectory()) walk(r); else if (/\.png$/i.test(name)) out.push(r);
    }
  };
  walk(skin);
  return out;
}

/**
 * Pair the screenshots in two directories, laid out as `<dir>/<android|ios>/<screen>.png`.
 * Each pair names its sides explicitly. Changed pairs come first, then the rest; the list holds at most six
 * pairs and `moreCount` is how many were left out.
 */
export function pairShots(beforeDir: string, afterDir: string): { pairs: ShotPair[]; moreCount: number } {
  const all: ShotPair[] = [];
  for (const skin of SKINS) {
    const b = new Map(listSkin(beforeDir, skin).map((r) => [r.slice(skin.length + 1).replace(/\.png$/i, ""), r]));
    const a = new Map(listSkin(afterDir, skin).map((r) => [r.slice(skin.length + 1).replace(/\.png$/i, ""), r]));
    for (const screen of [...new Set([...b.keys(), ...a.keys()])].sort()) {
      const before = b.get(screen), after = a.get(screen);
      const changed = !before || !after || !readFileSync(join(beforeDir, ...before.split("/"))).equals(readFileSync(join(afterDir, ...after.split("/"))));
      all.push({ screen, skin, ...(before ? { before } : {}), ...(after ? { after } : {}), changed });
    }
  }
  const ordered = [...all.filter((p) => p.changed), ...all.filter((p) => !p.changed)];
  return { pairs: ordered.slice(0, MAX_PAIRS), moreCount: Math.max(0, ordered.length - MAX_PAIRS) };
}

/** `shipvo ci shots --before <dir> --after <dir> --json`: print the pairs. Nothing is uploaded or posted. */
async function pairsCmd(argv: string[]): Promise<number> {
  const val = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const before = val("--before"), after = val("--after");
  const run = async () => {
    if (!before || !after) throw new UsageError("shipvo ci shots: --before <dir> and --after <dir> are both required");
    for (const d of [before, after]) if (!existsSync(d) || !statSync(d).isDirectory()) throw new UsageError(`not a directory: ${d}`);
    const r = pairShots(before, after);
    const n = r.pairs.filter((p) => p.changed).length;
    return { code: "pairs", summary: `${n} changed screen${n === 1 ? "" : "s"} listed${r.moreCount ? `, ${r.moreCount} more` : ""}`, data: r, next: [] };
  };
  if (argv.includes("--json")) { await runJson(run, []); return Number(process.exitCode ?? 0); }
  try { const d = await run(); console.log(d.summary); for (const p of (d.data as { pairs: ShotPair[] }).pairs) console.log(`${p.changed ? "changed" : "same   "} ${p.skin} ${p.screen}`); return 0; }
  catch (e) { console.error(e instanceof Error ? e.message : e); return 2; }
}

/** `shipvo ci shots --changed-from <sha> [--sim url] [--out dir]`. Never fails the check. */
export async function shotsCmd(argv: string[]): Promise<number> {
  if (argv.includes("--before") || argv.includes("--after")) return pairsCmd(argv);
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
