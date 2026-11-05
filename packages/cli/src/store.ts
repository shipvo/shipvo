import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize, sep } from "node:path";
import { checkCount, checkScreenshot, deriveStoreDetails, renderDataSafetyCsv, renderPrivacyPolicy, SCREENSHOT_SETS, type ScreenshotSet } from "@shipvo/store";
import { args, loadConfig } from "./config.js";

/** `shipvo store details --dry-run [--out dir]`: print the answers, write two files. Nothing is uploaded; no credentials are read. */
export async function store(argv: string[], deps: StoreDeps = {}): Promise<void> {
  const [sub, ...rest] = argv;
  if (sub === "screenshots") return screenshots(rest, deps);
  if (sub !== "details") { console.error("Usage: shipvo store details --dry-run [--out dir]\n       shipvo store screenshots [--out dir]"); process.exit(2); }
  const a = args(rest);
  if (a["dry-run"] === undefined || a["dry-run"] === "false") { console.error("shipvo store details: upload is not available yet; use --dry-run"); process.exit(2); }
  const cfg = loadConfig();
  const d = deriveStoreDetails(cfg);
  const out = a.out && a.out !== "true" ? a.out : ".shipvo/store";
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "data-safety.csv"), renderDataSafetyCsv(d));
  writeFileSync(join(out, "privacy-policy.md"), renderPrivacyPolicy(d));
  console.log(`Data safety answers for ${d.appName} (derived from shipvo.json):`);
  if (d.rows.length === 0) console.log("  No declared capability touches user data.");
  for (const r of d.rows) console.log(`  ${r.dataType}: collected ${r.collected}, shared ${r.shared}, purpose ${r.purpose}`);
  if (d.fill.total > 0) console.log(`Filled without you: ${d.fill.filled} of ${d.fill.total} fields.`);
  console.log(`\nYou still need to answer (${d.unknown.length}):`);
  for (const u of d.unknown) console.log(`  - ${u.question}`);
  console.log(`\nWrote ${join(out, "data-safety.csv")} and ${join(out, "privacy-policy.md")}. Nothing was uploaded.`);
}

/** Draws one route of the web build at a CSS viewport and returns image bytes (PNG or JPEG). */
export type RenderFn = (route: string, set: ScreenshotSet) => Promise<Uint8Array>;
export interface StoreDeps { render?: RenderFn; close?: () => Promise<void> }

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".css": "text/css", ".ttf": "font/ttf", ".ico": "image/x-icon" };

/** Maps a request URL to a file inside `dist`. Anything outside `dist`, missing, or without an extension gets index.html (single-page app). */
export function resolveStaticFile(dist: string, url: string): string {
  const index = join(dist, "index.html");
  let path: string;
  try { path = decodeURIComponent(url.split("?")[0]); } catch { return index; }
  const file = join(dist, normalize(path));
  if (!file.startsWith(dist + sep) || extname(file) === "" || !existsSync(file)) return index;
  return file;
}

/** `routes` must be an array of strings that start with "/". Returns a plain message, or undefined when valid. */
export function checkRoutes(routes: unknown): string | undefined {
  if (routes === undefined) return undefined;
  if (!Array.isArray(routes) || !routes.every((r) => typeof r === "string" && r.startsWith("/"))) return `"routes" in shipvo.json must be a list of paths that start with "/", for example ["/", "/cart"].`;
  return undefined;
}

/** Fast-mode renderer: the app's Playwright draws `sim-dist` (the same web build `shipvo sim` serves). JPEG output has no alpha channel. */
export async function playwrightRenderer(root: string): Promise<{ render: RenderFn; close: () => Promise<void> }> {
  const dist = join(root, "sim-dist");
  if (!existsSync(join(dist, "index.html"))) { console.error("No sim-dist build. Run `shipvo sim` once (or `PN_SIM=1 npx expo export --platform web --output-dir sim-dist`) first."); process.exit(2); }
  let pw: { chromium: { launch(): Promise<any> } };
  try { pw = createRequire(join(root, "package.json"))("playwright"); }
  catch { console.error("Install playwright in this app: npm i -D playwright && npx playwright install chromium"); process.exit(2); }
  const server = createServer((req, res) => {
    const file = resolveStaticFile(dist, req.url ?? "/");
    res.setHeader("content-type", MIME[extname(file)] ?? "application/octet-stream");
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const browser = await pw.chromium.launch();
  return {
    render: async (route, set) => {
      const ctx = await browser.newContext({ viewport: { width: Math.round(set.width / set.scale), height: Math.round(set.height / set.scale) }, deviceScaleFactor: set.scale, isMobile: true, hasTouch: true });
      try {
        const page = await ctx.newPage();
        await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(300);
        return new Uint8Array(await page.screenshot({ type: "jpeg", quality: 95 }));
      } finally { await ctx.close(); }
    },
    close: async () => { await browser.close(); server.close(); },
  };
}

const slug = (route: string) => route.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9]+/g, "-") || "home";

/** `shipvo store screenshots [--out dir]`: fast mode. Renders each route at each store size and checks every file. */
async function screenshots(rest: string[], deps: StoreDeps): Promise<void> {
  const a = args(rest);
  const cfg = loadConfig();
  const badRoutes = checkRoutes(cfg.routes);
  if (badRoutes) { console.error(badRoutes); process.exit(2); }
  const routes = cfg.routes?.length ? cfg.routes : ["/"];
  const out = a.out && a.out !== "true" ? a.out : "store-assets/raw";
  const own = deps.render ? undefined : await playwrightRenderer(process.cwd());
  const render = deps.render ?? own!.render;
  console.log("fast mode: simulator render, not the native UI");
  let bad = 0;
  const short: string[] = [];
  try {
    for (const set of SCREENSHOT_SETS) {
      if (set.id === "play-icon") continue;   // the icon is your own file, not a screen; see below
      const dir = join(out, set.id);
      mkdirSync(dir, { recursive: true });
      const list = set.id === "play-feature" ? routes.slice(0, 1) : routes;
      console.log(`\n${set.label} (${set.id}), ${set.width}x${set.height}:`);
      const ext = (b: Uint8Array) => (b[0] === 0x89 ? "png" : "jpg");
      for (const route of list) {
        const bytes = await render(route, set);
        const file = join(dir, `${slug(route)}.${ext(bytes)}`);
        writeFileSync(file, bytes);
        const r = checkScreenshot(bytes, set.id);
        if (!r.ok) bad++;
        console.log(`  ${r.ok ? "ok  " : "FAIL"} ${file}${r.ok ? "" : ": " + r.problems.join("; ")}`);
      }
      if (set.id === "play-feature") console.log(`  note: the feature graphic is a placeholder (a render of "${list[0]}"). Replace it with your own artwork.`);
      const c = checkCount(set.id, list.length);
      if (c && list.length < set.min) { short.push(set.id); console.log(`  note: needs ${set.min} screens, has ${list.length}. Add ${set.min - list.length} more to "routes" in shipvo.json before you submit.`); }
      else if (c) { bad++; console.log(`  FAIL ${c}. Remove ${list.length - set.max} from "routes" in shipvo.json.`); }
    }
    const icon = cfg.listing?.icon;
    if (icon && existsSync(icon)) {
      const r = checkScreenshot(readFileSync(icon), "play-icon");
      if (!r.ok) bad++;
      console.log(`\nPlay icon ${icon}: ${r.ok ? "ok" : "FAIL " + r.problems.join("; ")}`);
    } else console.log("\nPlay icon: listing.icon not found, not checked (Shipvo does not draw icons).");
  } finally { await (deps.close ?? own?.close)?.(); }
  console.log(`\nRaw files are in ${out}. ${bad === 0 ? `Every file passed the store checks.${short.length ? ` ${short.length} set${short.length === 1 ? " needs" : "s need"} more screens before you submit.` : ""}` : `${bad} problem${bad === 1 ? "" : "s"} above.`}`);
  console.log("Nothing was uploaded.");
  if (bad > 0) process.exitCode = 1;
}
