#!/usr/bin/env node
// Shipvo UI simulator: runs the real app UI (React Native Web build) in a phone-sized headless browser,
// and lets an agent see the screen as an accessibility tree and act on it: tap, type, scroll, back.
// No emulator, no device. Each session also gets a mock control plane that records orders for grading.
//   shipvo sim  (or: node packages/sim/server.mjs) [--port 4545] [--dir /tmp/pn-ui] [--dist ./sim-dist] [--app <id>]
// Reads shipvo.json in the current directory (appId, name, controlPlane) when present.
import http from "node:http";
import { readFileSync, existsSync, writeFileSync, appendFileSync, mkdirSync, statSync, rmSync } from "node:fs";
import { join, extname, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { withAppName } from "./app-name.mjs";
import { openBuild } from "./build-open.mjs";
import { fetchBuild, BuildCacheError } from "./build-cache.mjs";
import { parseMockRules } from "./mock-rules.mjs";
import { applyProfile, getProfile } from "./network-profiles.mjs";
import { installNetGate } from "./net-gate.mjs";
import { pushNotification } from "./push-notification.mjs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { resolveBrowser } from "./browser-resolver.mjs";
import { PhoneBrowser, BrowserError, checkUrl } from "./phone-browser.mjs";
import { acceptWebSocket } from "./ws-lite.mjs";
import { createWatch, watchPage, watchList, closeWatchers, isWatched, describeStep, changeLine } from "./watch.mjs";
import { browserAppPage } from "./browser-app.mjs";
import { launchErrorMessage } from "./chromium-hint.mjs";
import { shadeAction, SHADE_ACTIONS } from "./shade-actions.mjs";
import { settingsAction, syncMedia, SETTINGS_ACTIONS } from "./settings-actions.mjs";
import { SettingsError } from "./settings.mjs";
import { AppsError, loadProfile, resolveUrl, profilePatch, installApp, findApps, uninstallApp, switchApp, describeApps } from "./apps.mjs";
import { UpdateError, createUpdate, checkForUpdate, applyUpdate, bootDone, updateView, bannerText } from "./update.mjs";
import { ShadeError } from "./shade.mjs";
import { createNav, pressHome, openRecents, resume, killApp, assertForeground, setVisibilityInPage, awayScreenHtml, NavError } from "./nav.mjs";
import { createLifecycle, lock, unlock, restart, assertUnlocked, LifecycleError } from "./lifecycle.mjs";
import { applyScreenRules, clearScreenRules, filterTree } from "./screen-rules.mjs";
// Playwright: the app's own install first (its browsers match it), then this package's, then a global one.
const require_ = createRequire(import.meta.url);
let pw, pwVersion;
for (const from of [() => createRequire(join(process.cwd(), "package.json")), () => require_, () => { const root = execSync("npm root -g").toString().trim(); return (id) => require_(join(root, id)); }]) {
  try { const r = from(); pw = r("playwright"); try { pwVersion = r("playwright/package.json").version; } catch {} break; } catch {}
}
if (!pw) { console.error("playwright is not installed: npm i -D playwright && npx playwright install chromium"); process.exit(2); }
const { chromium, devices } = pw;

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
let CFG = {}; try { CFG = JSON.parse(readFileSync(join(process.cwd(), "shipvo.json"), "utf8")); } catch {}
const PORT = Number(arg("port", 4545)), DIR = arg("dir", "/tmp/pn-ui"), DIST = arg("dist", join(process.cwd(), "sim-dist"));
// phone.json: only a missing default ./phone.json is ignored. A bad --phone path or a bad file fails sessions with bad_profile.
let PROFILE = null, PROFILE_ERR = null;
{ const given = arg("phone", null);
  try { PROFILE = readFileSync(given ?? join(process.cwd(), "phone.json"), "utf8"); }
  catch (e) { if (given || e?.code !== "ENOENT") PROFILE_ERR = `cannot read ${given ?? "phone.json"}: ${e?.code ?? e?.message}`; } }
// Simulated OTA source: a control plane stub that serves <url>/pointer.json (signed) and the bundle. The key is the app's public key.
const UPDATE = { url: arg("update-url", process.env.PN_UPDATE_URL || ""), key: arg("update-key", process.env.PN_UPDATE_KEY || "") };
const DEFAULT_APP = arg("app", CFG.appId || "tide"), APP_NAME = CFG.name || "Tide & Tackle";
// Published releases: open_app("tide@r13") loads the web artifact that `shipvo publish` stored next to the phone bundle.
const CONTROL = (process.env.PN_CONTROL || process.env.CONTENT_FROM || CFG.controlPlane || "https://api.shipvo.dev").replace(/\/$/, "");
async function resolveApp(spec) {
  const m = /^([a-z0-9-]+)(?:@(?:r?(\d+)|(latest)))?$/.exec(String(spec || DEFAULT_APP)); if (!m) throw new Error(`bad app spec "${spec}": use "${DEFAULT_APP}", "${DEFAULT_APP}@r13" or "${DEFAULT_APP}@latest"`);
  const [, app, rel] = m;
  const hasLocal = existsSync(join(DIST, "index.html"));
  if (!rel && !m[3] && hasLocal && app === DEFAULT_APP) return { app, url: `http://localhost:${PORT}/app/`, release: "local" };   // the local build (development)
  // otherwise a published release: the one asked for, or the latest (hosted: there is no local build)
  let n = rel ? Number(rel) : null;
  if (!n) { const r = await fetch(`${CONTROL}/w/${app}/releases.json`); if (!r.ok) throw new Error(`no published web artifact for ${app}`); n = (await r.json()).latest; }
  // Served through this process so the page and its mock backend share one origin (a page on https cannot fetch http://localhost).
  return { app, url: `http://localhost:${PORT}/w/${app}/r${n}/index.html`, release: n };
}
mkdirSync(DIR, { recursive: true });
const BUILD_DIR = join(DIR, "builds"), BUILDS = new Map();   // content id -> unpacked folder
const BUILD_HOSTS = (process.env.PN_BUILD_ALLOW_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".ttf": "font/ttf", ".css": "text/css" };
// Chromium starts after the server is listening (see the end of this file). Handlers await this shared promise.
const LAUNCH_TIMEOUT_MS = 60_000;
let launchBrowser;
const browserReady = new Promise((resolve, reject) => { launchBrowser = () => {
  // Resolve first (it may download a browser, which can take longer than the launch timeout), then time the launch only.
  let opts;
  try { opts = resolveBrowser({ pw, executablePath: arg("chromium", undefined) }); } catch (e) { reject(e); return; }
  const timer = setTimeout(() => reject(new Error(`Chromium did not start within ${LAUNCH_TIMEOUT_MS / 1000} s`)), LAUNCH_TIMEOUT_MS);
  chromium.launch(opts).then(resolve, reject).finally(() => clearTimeout(timer));
}; });
browserReady.catch((e) => { console.error(`sim: ${launchErrorMessage(e.message, pwVersion)}`); process.exit(1); });
const sessions = new Map();

const phone = { ...devices["Pixel 5"], viewport: { width: 393, height: 851 } };

// The phone's Browser app. Chromium starts on the first open. Pages that link to the app's own scheme hand the link to the app.
// The instance is shared through s.browserP, so two opens at once make one Chromium context.
function phoneBrowser(s) {
  s.browserP ??= (async () => {
    s.peers = s.peers ?? new Set();
    const b = new PhoneBrowser(await browserReady, { allowPrivate: false, allowHosts: [], device: phone, onDeepLink: (u) => {
      s.page.evaluate((x) => globalThis.__pnDevice?.openUrl(x), u).catch(() => {});
      for (const peer of s.peers) peer.send(JSON.stringify({ type: "app", url: u }));   // the phone goes back to the app
    } });
    b.onChange = () => pushState(s);
    s.browser = b;
    return b;
  })();
  s.browserP.catch(() => { s.browserP = undefined; });
  return s.browserP;
}
// One screencast feeds every viewer of the Browser app.
function ensureCast(s) {
  const b = s.browser; if (!b?.page || b.screencast || !s.peers?.size) return;
  b.startScreencast((f) => { const msg = JSON.stringify({ type: "frame", ...f }); for (const p of s.peers) p.send(msg); }).catch(() => {});
  pushState(s);
}
async function pushState(s) {
  const b = s.browser; if (!b || !s.peers?.size) return;
  const tabs = await b.tabs().catch(() => []);
  const msg = JSON.stringify({ type: "state", tabs, url: b.page?.url() ?? "" });
  for (const peer of s.peers) peer.send(msg);
}
/** Opens a web page in the Browser app. Resolves { ok: true }, or { ok: false, code, message } when the page is refused. Viewers get an `error` message too. */
async function openInBrowserApp(id, url) {
  const s = sessions.get(id); if (!s) return { ok: false, code: "no_session", message: "no session" };
  const b = await phoneBrowser(s);
  for (const peer of s.peers ?? []) peer.send(JSON.stringify({ type: "browser", url }));   // the phone shows the Browser app
  try { await b.open(url); ensureCast(s); return { ok: true }; } catch (e) {
    const r = { ok: false, code: e.code ?? "error", message: String(e.message).split("\n")[0] };
    for (const peer of s.peers ?? []) peer.send(JSON.stringify({ type: "error", code: r.code, message: r.message }));
    return r;
  }
}

// The mock backend a session uses: its own, or the shared one of its room. A room ends when its last session ends.
const rooms = new Map();   // room -> Set of session ids
const backendOf = (id, room) => (room ? `~${room}` : id);
function leaveRoom(s, id) {
  if (!s.room) return;
  const set = rooms.get(s.room); set?.delete(id);
  if (!set?.size) { rooms.delete(s.room); try { rmSync(join(DIR, `${backendOf(id, s.room)}.json`), { force: true }); rmSync(join(DIR, `${backendOf(id, s.room)}.json.log`), { force: true }); } catch {} }
}
async function endSession(id) {
  const s = sessions.get(id); if (!s) return false;
  for (const p of s.peers ?? []) p.close(); closeWatchers(s);
  await (await s.browserP?.catch(() => undefined))?.close(); await s.ctx.close().catch(() => {});
  sessions.delete(id); leaveRoom(s, id); return true;
}
async function newSession(id, opts = {}) {
  const room = opts.room == null ? undefined : String(opts.room);
  if (room !== undefined && !/^[\w-]{1,64}$/.test(room)) throw new SimError("bad_room", "room must be 1 to 64 letters, digits, _ or -");
  if (sessions.has(id)) { const old = sessions.get(id); for (const p of old.peers ?? []) p.close(); closeWatchers(old); await (await old.browserP?.catch(() => undefined))?.close(); await old.ctx.close().catch(() => {}); sessions.delete(id); leaveRoom(old, id); }
  let target, buildId;
  if (opts.build_url != null) {
    // Fetch the build before anything else is created, so a bad URL leaves no session behind.
    const spec = /^([a-z0-9-]+)/.exec(String(opts.app || DEFAULT_APP)); if (!spec) throw new SimError("bad_app", `bad app spec "${opts.app}"`);
    const b = await openBuild(String(opts.build_url), { dir: BUILD_DIR, allowHosts: BUILD_HOSTS, ...(Number(process.env.PN_BUILD_MAX_BYTES) > 0 ? { maxBytes: Number(process.env.PN_BUILD_MAX_BYTES) } : {}) });
    BUILDS.set(b.id, b.root);
    buildId = typeof opts.build === "string" && /^[\w-]{1,64}$/.test(opts.build) ? opts.build : b.id;
    target = { app: spec[1], url: `http://localhost:${PORT}/b/${b.id}/index.html`, release: `build:${buildId}` };
  } else target = await resolveApp(opts.app);
  const bk = backendOf(id, room);
  if (!room || !rooms.has(room)) { writeFileSync(join(DIR, `${bk}.json`), JSON.stringify({ orders: [] })); writeFileSync(join(DIR, `${bk}.json.log`), ""); }
  if (room) { if (!rooms.has(room)) rooms.set(room, new Set()); rooms.get(room).add(id); }
  let ctx;
  try {
  const browser = await browserReady;
  // Optional width, height (output pixels) and scale (device pixel ratio) make a session render at a store screenshot size.
  const size = Number.isInteger(opts.width) && Number.isInteger(opts.height) && opts.width > 0 && opts.height > 0 ? { viewport: { width: Math.round(opts.width / (opts.scale || 1)), height: Math.round(opts.height / (opts.scale || 1)) }, deviceScaleFactor: opts.scale || 1 } : {};
  ctx = await browser.newContext({ ...phone, ...size, colorScheme: opts.dark ? "dark" : "light" });
  // The app's Linking.openURL for a web page lands here (see @shipvo/device): it opens in the Browser app, not in the app.
  await ctx.exposeFunction("__pnOpenBrowser", (url) => openInBrowserApp(id, String(url)));
  // The app's Linking.openURL for another installed app's scheme lands here: the phone switches to that app and hands it the link once.
  // Returns true when another app took the link; false means deliver it inside the current app as before.
  await ctx.exposeFunction("__pnOpenLink", async (url) => {
    const s = sessions.get(id); if (!s) return false;
    // Same rules as open_url: a locked phone, the home screen or the app switcher takes no link. Do not switch.
    try { assertUnlocked(s.life); assertForeground(s.nav); } catch { return false; }
    let r;
    try { r = resolveUrl(s.apps, String(url), []); } catch { return false; }
    if (!r.app || r.app === s.apps.current_app || !s.apps.installed_apps.some((a) => a.id === r.app)) return false;
    try { await switchToApp(s, s.page, r.app); } catch { return s.apps.current_app === r.app; }
    // The phone has switched, so the link is not delivered inside the old app, whatever happens next.
    try { await s.page.evaluate((u) => { globalThis.__pnDevice?.setInitialUrl?.(u); return globalThis.__pnDevice?.openUrl(u); }, String(url)); } catch {}
    return true;
  });
  await ctx.addInitScript((cfg) => { globalThis.__PN_SIM__ = cfg; }, { baseUrl: `http://localhost:${PORT}/s/${bk}`, appId: target.app, appName: APP_NAME, seed_cart: opts.seed_cart ?? null, device: opts.device ?? null });
  await ctx.addInitScript(installNetGate);
  const page = await ctx.newPage();
  const errors = [];
  // phone.json: the apps and settings this phone starts with. The same profile gives the same phone every run.
  let apps; try { if (PROFILE_ERR && opts.phone === undefined) throw new AppsError("bad_profile", PROFILE_ERR); apps = loadProfile(opts.phone ?? PROFILE ?? {}); } catch (e) { await ctx.close(); throw e instanceof AppsError ? new SimError(e.code, e.message) : e; }
  const pageErrors = { n: 0 };
  page.on("pageerror", (e) => { pageErrors.n++; errors.push(String(e?.message ?? e).split("\n")[0]); });
  await page.goto(target.url, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const patch = profilePatch(apps);
  if (Object.keys(patch).length) { await page.evaluate((p) => globalThis.__pnDevice?.set?.(p), patch); await syncMedia(page); }
  sessions.set(id, { pageErrors, update: createUpdate({ release: target.release, url: target.url }), updateSrc: { url: opts.update_url ?? UPDATE.url, key: opts.update_key ?? UPDATE.key }, apps, ctx, page, errors, app: target.app, release: target.release, room, skin: opts.skin === "ios" ? "ios" : "android", startedAt: new Date().toISOString(), life: createLifecycle(), shade: { open: "none" }, nav: createNav() });
  if (buildId) sessions.get(id).build = buildId;
  watch.refresh();   // /watch viewers move to the new session unless they picked one
  } catch (e) {
    // A failed open leaves nothing behind: no ghost room member, no backend file.
    await ctx?.close().catch(() => {});
    if (room) leaveRoom({ room }, id); else try { rmSync(join(DIR, `${bk}.json`), { force: true }); rmSync(join(DIR, `${bk}.json.log`), { force: true }); } catch {}
    throw e;
  }
}

// Refs are only meaningful for the document that issued them: a full page load restarts Playwright's counter, so an
// old "e5" would point at a different element. Each document gets an epoch; refs after the first load are "p<epoch>e5".
const DOCS = new WeakMap();
async function epochOf(page) {
  const id = await page.evaluate(() => (globalThis.__pnDoc ??= Math.random().toString(36).slice(2)));
  const d = DOCS.get(page);
  if (!d) DOCS.set(page, { id, epoch: 0 }); else if (d.id !== id) { d.id = id; d.epoch++; }
  return DOCS.get(page).epoch;
}
// The update banner is a status element in the page, so it is in the accessibility tree. A reload drops it, so boot puts it back.
async function showBanner(s) {
  const text = bannerText(s.update);
  await s.page.evaluate((t) => { document.querySelector("[data-pn-update-banner]")?.remove(); if (!t) return;
    const d = document.createElement("div"); d.setAttribute("data-pn-update-banner", ""); d.setAttribute("role", "status"); d.setAttribute("aria-label", t); d.textContent = t;
    d.style.cssText = "position:fixed;left:8px;right:8px;top:8px;z-index:2147483647;padding:8px 12px;border-radius:12px;background:#1d2733;color:#fff;font:600 13px system-ui,sans-serif;pointer-events:none";
    document.body.appendChild(d); }, text).catch(() => {});
}
// One boot of the app. `url` loads that bundle, else the page reloads (a cold start). A page error while loading is a failed boot: three in a row
// on a new release send the phone back to the release it had.
async function boot(s, url) {
  const before = s.pageErrors.n;
  if (url) await s.page.goto(url, { waitUntil: "networkidle" }); else await s.page.reload({ waitUntil: "networkidle" });
  await s.page.waitForTimeout(300);
  await reapplyNetProfile(s, s.page);
  const r = bootDone(s.update, s.pageErrors.n > before);
  if (r.revert) { await s.page.goto(r.url, { waitUntil: "networkidle" }); await s.page.waitForTimeout(300); }
  await showBanner(s);
}
// A new page load starts with a fresh device state, so the session's network profile is set on it again.
async function reapplyNetProfile(s, page) {
  if (s.netProfile) await page.evaluate((n) => globalThis.__pnDevice?.set?.({ networkProfile: n }), s.netProfile).catch(() => {});
}
// The bundle a Store listing points at: app://<id>[@rN] is the published web artifact; an http(s) URL is fetched as given.
// Same host guard and size cap as build_url. Resolves { sha256, bytes }, or throws SimError store_app_unreachable / too_large / host_not_allowed.
async function fetchAppBundle(app) {
  const url = String(app.url ?? "");
  let from = url, allowHosts = [];
  const am = /^app:\/\/([a-z0-9-]+(?:@(?:r?\d+|latest))?)$/.exec(url);
  if (am) { const t = await resolveApp(am[1].includes("@") ? am[1] : `${am[1]}@latest`).catch((e) => { throw new SimError("store_app_unreachable", String(e.message).split("\n")[0]); }); from = `${CONTROL}/w/${t.app}/r${t.release}/index.html`; allowHosts = [new URL(CONTROL).hostname]; }   // the control plane is the operator's own
  try { const r = await fetchBuild(from, { dir: join(DIR, "builds"), allowHosts }); return { sha256: r.id, bytes: r.bytes }; }
  catch (e) { if (e instanceof BuildCacheError) throw new SimError(e.code === "unreachable" ? "store_app_unreachable" : e.code, e.message); throw e; }
}
async function switchToApp(s, page, id) {
  const url = s.apps.installed_apps.find((a) => a.id === id)?.url ?? "";
  // fixture: pages are stand-ins (no navigation). app://<id>[@rN] loads a published release like open_app. Anything else
  // must pass the same private-host guard as the Browser app, so a profile cannot point Chromium at the local network.
  let dest = null;
  const am = /^app:\/\/([a-z0-9-]+(?:@(?:r?\d+|latest))?)$/.exec(url);
  if (am) dest = (await resolveApp(am[1])).url;
  else if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^fixture:/i.test(url)) {
    try { dest = (await checkUrl(url, { allowPrivate: false, allowHosts: [] })).href; }
    catch (e) { if (e instanceof BrowserError) throw new SimError(e.code, e.message); throw e; }
  }
  switchApp(s.apps, id, s.nav);
  if (dest && page.url() !== dest) { await page.goto(dest, { waitUntil: "networkidle" }); await page.waitForTimeout(300); }
  await reapplyNetProfile(s, page);
  await page.evaluate(setVisibilityInPage, "active");
  // A one-shot link belongs to the load it was delivered to: a plain switch never inherits one.
  await page.evaluate(() => globalThis.__pnDevice?.setInitialUrl?.(null));
}
// Fetch layer. Mock rules win; otherwise fetch/XHR run under the session's network profile (default online, untouched).
async function ensureNetworkRoute(s, page) {
  if (s.mockRoute) return;
  s.mockRoute = true;
  await page.route("**/*", async (route) => {
    const req = route.request();
    const type = req.resourceType();
    if (type !== "fetch" && type !== "xhr") return route.fallback();
    const rule = (s.mocks ?? []).find((m) => (!m.method || m.method === req.method()) && m.match(req.url()));
    if (rule) {
      if (rule.delayMs) await new Promise((r) => setTimeout(r, rule.delayMs));
      // The app page may come from another origin, so the stub must pass the browser's CORS check.
      return route.fulfill({ status: rule.status, body: rule.body, headers: { "access-control-allow-origin": "*", ...rule.headers } }).catch(() => {});
    }
    if (!s.profiled) return route.fallback();
    try {
      const { res } = await s.profiled(req.url(), { method: req.method(), body: req.postDataBuffer() ?? undefined, route });
      await route.fulfill({ response: res }).catch(() => {});
    } catch { await route.abort("internetdisconnected").catch(() => {}); }
  });
}

// Set the session's network profile. Throws unknown_profile for a bad name. Logged in device_log as simulated.
async function setNetworkProfile(s, page, name) {
  let profile; try { profile = getProfile(name); } catch (e) { throw new SimError(e.code, e.message); }
  const from = s.netProfile ?? "online";
  s.netProfile = name;
  s.profiled = name === "online" ? null : applyProfile(async (_url, init) => {
    // Playwright's APIResponse has headers() as a method. A chunked reply has no content-length, so use the body size.
    const res = await init.route.fetch(); const headers = res.headers(); const size = String((await res.body()).length);
    return { res, headers: { get: (n) => { const k = String(n).toLowerCase(); return headers[k] ?? (k === "content-length" ? size : null); } } };
  }, profile, { clock: { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) } });
  if (s.profiled) await ensureNetworkRoute(s, page);
  // The phone itself learns the profile too, so the in-page gate fails offline calls with the phone's own error.
  await page.evaluate((n) => globalThis.__pnDevice?.set?.({ networkProfile: n }), name).catch(() => {});
  (s.netLog ??= []).push({ at: Date.now(), name: "network_profile", profile: name, from, source: "simulated" });
}

class SimError extends Error { constructor(code, message) { super(message); this.code = code; } }

async function screen(page) {
  await page.waitForTimeout(150);
  const epoch = await epochOf(page);
  // Hide what a phone would not expose, so an agent learns to swipe a rail exactly as it must on a device.
  await page.evaluate(`(${clearScreenRules})(document); (${applyScreenRules})(document)`);
  // What is hidden from assistive tech must not appear at all: this Playwright keeps aria-hidden nodes but strips
  // their names. `inert` removes them from the accessibility tree; it is set only for the snapshot and removed after.
  await page.evaluate(() => { for (const el of document.querySelectorAll('[aria-hidden="true"]')) { el.setAttribute("data-pn-prev-display", el.style.display || ""); el.style.setProperty("display", "none", "important"); } });
  const tree = await page.locator("body").ariaSnapshot({ mode: "ai" });
  await page.evaluate(() => { for (const el of document.querySelectorAll("[data-pn-prev-display]")) { const prev = el.getAttribute("data-pn-prev-display"); if (prev) el.style.display = prev; else el.style.removeProperty("display"); el.removeAttribute("data-pn-prev-display"); } });
  const text = filterTree(tree);
  return epoch ? text.replace(/\[ref=(e\d+)\]/g, `[ref=p${epoch}$1]`) : text;
}

function log(id, action, ok, extra = {}) { appendFileSync(join(DIR, `${id}.json.log`), JSON.stringify({ at: Date.now(), name: action, ok, ...extra }) + "\n"); }

async function act(id, body) {
  const s = sessions.get(id); if (!s) throw new SimError("no_session", `no session '${id}': call /session first`);
  const { page } = s;
  // A ref is valid only for the page it came from and while its element is unchanged. Re-snapshot first, so a node that
  // was re-rendered with new content has lost its old ref, then fail with a typed error instead of acting on anything else.
  const loc = (ref) => page.locator(`aria-ref=${ref}`);
  const resolve = async (ref) => {
    const m = /^(?:p(\d+))?(e\d+)$/.exec(String(ref));
    const stale = () => new SimError("stale_ref", `stale ref ${ref}: the screen changed. Take a new snapshot (action "screen") and use a ref from it.`);
    if (!m) return loc(ref);
    await screen(page);
    if (Number(m[1] ?? 0) !== DOCS.get(page).epoch) throw stale();
    const l = loc(m[2]);
    if ((await l.count()) !== 1) throw stale();
    return l;
  };
  // Before acting on an element, say why it cannot receive the action. Nothing has reached the app when this throws.
  const NOT_DELIVERED = { not_visible: "is not visible", disabled: "is disabled", covered: "is covered by another element" };
  const ready = async (l) => {
    const fail = (reason, what) => new SimError(reason, `${what} ${NOT_DELIVERED[reason]}, so nothing was sent to the app.`);
    if (!(await l.isVisible())) throw fail("not_visible", String(body.ref));
    // Still off the screen after scrolling it into view (for example a fixed element parked outside the window).
    await l.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
    const box = await l.boundingBox(); const vp = page.viewportSize();
    if (!box || (vp && (box.x + box.width <= 0 || box.y + box.height <= 0 || box.x >= vp.width || box.y >= vp.height))) throw fail("not_visible", String(body.ref));
    if (await l.isDisabled()) throw fail("disabled", String(body.ref));
    const covered = await l.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && top !== el && !el.contains(top) && !top.contains(el);
    });
    if (covered) throw fail("covered", String(body.ref));
  };
  // A locked phone takes no input: say so with a typed error before anything reaches the app.
  if (["tap", "tap_xy", "type_keys", "type", "scroll", "back", "open_url", "open_notification", "install_app", "uninstall_app", "switch_app", ...SHADE_ACTIONS, ...SETTINGS_ACTIONS].includes(body.action)) { try { assertUnlocked(s.life); } catch (e) { throw new SimError(e.code, e.message); } }
  // Home screen or app switcher showing: the app is in the background and takes no input.
  if (["tap", "tap_xy", "type_keys", "type", "scroll", "back", "open_url", "open_notification", "open_notifications", "open_control_center", "toggle_tile", "dismiss_notification"].includes(body.action)) { try { assertForeground(s.nav); } catch (e) { throw new SimError(e.code, e.message); } }
  // An open panel covers the app on a phone, so input to the app is refused until it is closed.
  if (["tap", "tap_xy", "type_keys", "type", "scroll"].includes(body.action) && s.shade.open !== "none") throw new SimError("panel_open", `a panel (${s.shade.open}) is open and covers the app, so nothing was sent to it. Close it first (close_panels).`);
  switch (body.action) {
    // Home, recents, resume and kill. The app hears them as AppState changes (document.visibilityState). Kill is a cold start.
    case "press_home": case "open_recents": case "resume_app": case "kill_app": {
      let ev;
      try { ev = body.action === "press_home" ? pressHome(s.nav) : body.action === "open_recents" ? openRecents(s.nav) : body.action === "resume_app" ? resume(s.nav) : (killApp(s.nav), null); }
      catch (e) { if (e instanceof NavError) throw new SimError(e.code, e.message); throw e; }
      if (ev) await page.evaluate(setVisibilityInPage, ev);
      if (body.action === "kill_app") { s.life.reloads++; await boot(s); await page.evaluate(setVisibilityInPage, "background"); }
      const where = s.nav.where;
      return { where, appState: where === "app" ? "active" : "background", reloads: s.life.reloads, screen: where === "app" ? await screen(page) : where === "home" ? `Home screen\n- button "${APP_NAME}" (the app icon: resume_app opens it)\n${describeApps(s.apps)}` : `App switcher\n- card "${APP_NAME}" (resume_app opens it, kill_app closes it)` };
    }
    // Installed apps. Errors are typed: unknown_app, already_installed, not_installed. Logged in device_log: source "real" (with the bundle sha256) for a fetched bundle, "simulated" for a fixture app.
    case "install_app": case "uninstall_app": case "switch_app": {
      const id = String(body.id ?? "");
      try {
        if (body.action === "install_app") {
          const catalog = Array.isArray(body.catalog) ? body.catalog : s.apps.store;
          const found = catalog.find((a) => a?.id === id);
          if (found && s.apps.installed_apps.some((a) => a.id === id)) throw new AppsError("already_installed", `'${id}' is already installed`);   // before any download
          // A listing with a real URL is fetched first: the install keeps the bundle's sha256 and size, and fails if the bundle cannot be fetched.
          const real = found && !/^fixture:/i.test(String(found.url ?? "")) ? await fetchAppBundle(found) : undefined;
          installApp(s.apps, id, catalog, real);
        }
        else if (body.action === "uninstall_app") uninstallApp(s.apps, id, s.nav);
        else {
          await switchToApp(s, page, id);
        }
      } catch (e) { if (e instanceof AppsError) throw new SimError(e.code, e.message); throw e; }
      if (body.action === "uninstall_app" && s.nav.where === "home") await page.evaluate(setVisibilityInPage, "background");
      const where = s.nav.where;
      return { where, current_app: s.apps.current_app, installed_apps: s.apps.installed_apps, screen: where === "app" ? await screen(page) : `Home screen\n${describeApps(s.apps)}` };
    }
    // Search the Store by need. Read-only; logged in device_log as simulated.
    case "find_apps": {
      const catalog = Array.isArray(body.catalog) ? body.catalog : s.apps.store;
      const apps = findApps(catalog, { query: body.query, country: body.country, language: body.language, currency: body.currency, limit: body.limit }, s.apps.installed_apps);
      s.apps.log.push({ at: Date.now(), name: "find_apps", query: String(body.query ?? "").slice(0, 200), results: apps.length, source: "simulated" });
      return { apps, screen: null };
    }
    // Simulated lock, unlock and restart. Restart reloads the page (a cold start of the app); the browser context keeps storage.
    case "lock": case "unlock": {
      if (body.action === "lock") s.shade.open = "none";
      try { (body.action === "lock" ? lock : unlock)(s.life); } catch (e) { if (e instanceof LifecycleError) throw new SimError(e.code, e.message); throw e; }
      return { locked: s.life.locked, screen: s.life.locked ? "Lock screen" : await screen(page) };
    }
    // Simulated OTA: check (signed pointer, hash), apply (restart on the new bundle), state. Errors: no_update, not_ready. Every change is in device_log.
    case "get_update_state": case "check_for_update": case "apply_update": {
      try {
        if (body.action === "check_for_update") { await checkForUpdate(s.update, { url: s.updateSrc.url, publicKey: s.updateSrc.key }); await showBanner(s); }
        else if (body.action === "apply_update") {
          applyUpdate(s.update, (n) => `http://localhost:${PORT}/u/${body.session}/r${n}/index.html`);
          s.life.reloads++; s.shade.open = "none"; s.nav.where = "app"; s.life.locked = false;
          await boot(s, s.update.running.url);
        }
      } catch (e) { if (e instanceof UpdateError) throw new SimError(e.code, e.message); throw e; }
      return { update: updateView(s.update), banner: bannerText(s.update), reloads: s.life.reloads, screen: await screen(page) };
    }
    case "restart": {
      restart(s.life); s.shade.open = "none"; s.nav.where = "app";
      await boot(s);
      return { reloads: s.life.reloads, restarts: s.life.restarts, screen: await screen(page) };
    }
    case "screen": break;
    // Coordinate input, for the "screenshots and coordinates only" side of scripts/agent-efficiency. Not an MCP tool: agents using
    // the labelled screen tap by ref. x and y are CSS pixels from the top left of the screenshot.
    case "tap_xy": { const x = Number(body.x), y = Number(body.y); if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("tap_xy needs numbers x and y"); await page.mouse.click(x, y); break; }
    case "type_keys": await page.keyboard.type(String(body.text ?? ""), { delay: 5 }); if (body.enter) await page.keyboard.press("Enter"); break;
    case "tap": { const t = await resolve(body.ref); await ready(t); await t.click({ timeout: 3000 }); break; }
    // Where an element is: centre and size as 0..1 of the viewport. Used by the recorder to draw taps. Does not act.
    case "locate": {
      let box = null; const vp = page.viewportSize();
      try { box = await (await resolve(body.ref)).boundingBox({ timeout: 1000 }); } catch {}
      if (!box || !vp) throw new SimError("not_found", `no element ${body.ref} on this screen.`);
      const c = (v) => Math.min(1, Math.max(0, v));
      return { locate: { x: c((box.x + box.width / 2) / vp.width), y: c((box.y + box.height / 2) / vp.height), w: c(box.width / vp.width), h: c(box.height / vp.height) } };
    }
    case "type": {
      // A labelled text field may resolve to its wrapper; type into the real input inside it, as a phone focuses the field.
      let t = await resolve(body.ref);
      const kind = await t.evaluate((el) => (/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable) ? "field" : el.querySelector("input, textarea") ? "wrapper" : (el.getAttribute("aria-label") || el.textContent || "").trim(), { timeout: 3000 });
      if (kind === "wrapper") t = t.locator("input, textarea").first();
      else if (kind !== "field") {
        // Typing "on" a label or heading: a person would go to the field of that name. One match, or a clear error.
        const named = page.getByRole("textbox", { name: kind, exact: true });
        if ((await named.count()) !== 1) throw new Error(`${body.ref} is not a text field. Type into a "textbox" ref.`);
        t = named;
      }
      await ready(t);
      await t.fill(String(body.text ?? ""), { timeout: 3000 }); if (body.enter) await t.press("Enter");
      return { delivery: "delivered", value: await t.inputValue().catch(() => null), screen: await screen(page) };
    }
    case "scroll": {
      const target = body.ref ? await resolve(body.ref) : page.locator("body");
      const box = await target.boundingBox().catch(() => null);
      if (box) await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 400));
      await page.mouse.wheel(body.direction === "right" ? 300 : body.direction === "left" ? -300 : 0, body.direction === "up" ? -600 : body.direction === "down" ? 600 : 0);
      break;
    }
    // Simulated device: what the phone "has" and what happens to it. See @shipvo/device.
    case "set_device": await page.evaluate((d) => globalThis.__pnDevice?.set(d), body.device ?? {}); await syncMedia(page); break;
    case "open_notifications": case "open_control_center": case "close_panels": case "toggle_tile": case "dismiss_notification": {
      try { return { ...(await shadeAction(page, s.shade, body)) }; } catch (e) { if (e instanceof ShadeError) throw new SimError(e.code, e.message); throw e; }
    }
    case "get_settings": case "set_setting": {
      try { return { ...(await settingsAction(page, body)) }; } catch (e) { if (e instanceof SettingsError) throw new SimError(e.code, e.message); throw e; }
    }
    case "push_notification": return { ...(await pushNotification(page, body)), screen: await screen(page) };
    case "notifications": return { notifications: await page.evaluate(() => globalThis.__pnDevice?.notifications() ?? []), screen: await screen(page) };
    case "open_notification": { s.shade.open = "none"; const ok = await page.evaluate((nid) => globalThis.__pnDevice?.openNotification(nid), body.id); if (!ok) throw new Error("no such notification"); await page.waitForTimeout(400); break; }
    case "open_url": {
      if (typeof body.url !== "string" || !body.url) throw new SimError("bad_url", "open_url needs a url, such as myapp://item/3");
      let r; try { r = resolveUrl(s.apps, body.url, Array.isArray(CFG.schemes) && typeof CFG.appId === "string" ? [{ id: CFG.appId, schemes: CFG.schemes }] : []); } catch (e) { if (e instanceof AppsError) throw new SimError(e.code, e.message); throw e; }
      if (r.app && r.app !== s.apps.current_app && s.apps.installed_apps.some((a) => a.id === r.app)) {
        try { await switchToApp(s, page, r.app); } catch (e) { if (e instanceof AppsError) throw new SimError(e.code, e.message); throw e; }
        // switchToApp clears the initial URL, so set it after the switch. One-shot: no init script, so a later reload or switch never sees it.
        await page.evaluate((u) => globalThis.__pnDevice?.setInitialUrl?.(u), body.url);
      }
      if (r.app) { await page.evaluate((u) => globalThis.__pnDevice?.openUrl(u), body.url); await page.waitForTimeout(400); return { app: r.app, screen: await screen(page) }; }   // a listener, if the app has one, still gets the URL
      const handled = await page.evaluate((u) => globalThis.__pnDevice?.openUrl(u), body.url);
      if (!handled) throw new SimError("no_url_listener", `the app has no URL listener, so it did not handle ${body.url}. Register one with onUrl from @shipvo/device.`);
      await page.waitForTimeout(400); break;
    }
    // Stub fetch/XHR on the page. Rules live on the session; unmatched requests continue untouched.
    case "set_network_mocks": {
      let rules; try { rules = parseMockRules(body.rules ?? []); } catch (e) { throw new SimError(e.code ?? "mock_invalid", e.message); }
      s.mocks = rules;
      await ensureNetworkRoute(s, page);
      break;
    }
    case "set_network_profile": { await setNetworkProfile(s, page, body.profile); break; }
    // The phone's Chromium (isolated from the app page). Page text is untrusted: results carry source "web".
    case "browser_open": case "browser_snapshot": case "browser_click": case "browser_type": case "browser_back": case "browser_screenshot": case "browser_tabs": case "browser_close_tab": case "browser_scroll": case "browser_wait_for": {
      if (body.action === "browser_open" && body.url) { await phoneBrowser(s); if (body.allow_private !== undefined) s.browser.opts.allowPrivate = body.allow_private === true; if (Array.isArray(body.allow_hosts)) s.browser.opts.allowHosts = body.allow_hosts.map(String); }
      if (!s.browser) { if (body.action === "browser_open") throw new SimError("bad_url", "browser_open needs a url"); throw new SimError("no_page", "no page is open: call browser_open first"); }
      const b = s.browser;
      try {
        switch (body.action) {
          case "browser_open": { const r = await b.open(String(body.url ?? "")); ensureCast(s); return { ...r }; }
          case "browser_snapshot": return { ...(await b.snapshot()) };
          case "browser_click": return { ...(await b.click(body.ref)) };
          case "browser_type": return { ...(await b.type(body.ref, body.text, body.enter)) };
          case "browser_back": return { ...(await b.back()) };
          case "browser_tabs": return { source: "web", untrusted: true, tabs: await b.tabs() };
          case "browser_close_tab": return { source: "web", untrusted: true, tabs: await b.closeTab(Number(body.index)) };
          case "browser_scroll": return { ...(await b.scroll(Number.isFinite(body.dy) ? body.dy : 400, Number.isFinite(body.dx) ? body.dx : 0)) };
          case "browser_wait_for": return { ...(await b.waitFor({ text: body.text, gone: body.gone === true, timeoutMs: body.timeout_ms })) };
          default: { const p = join(DIR, `${id}-web-${Date.now()}.png`); writeFileSync(p, await b.screenshot()); return { path: p, source: "web", untrusted: true }; }
        }
      } catch (e) { throw e.code ? new SimError(e.code, e.message) : e; }
    }
    case "device_log": return { log: [...(await page.evaluate(() => globalThis.__pnDevice?.log() ?? [])), ...s.life.log, ...s.apps.log, ...s.update.log, ...(s.netLog ?? []), ...(s.browser?.navigations ?? [])], capabilities: await page.evaluate(() => globalThis.__pnDevice?.capabilities() ?? null), screen: await screen(page) };
    case "diag": {
      const r = await page.evaluate(async () => {
        const cfg = globalThis.__PN_SIM__ ?? {}; const out = { baseUrl: cfg.baseUrl, origin: location.origin };
        try { const res = await fetch(`${cfg.baseUrl}/o/${cfg.appId ?? "tide"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order: { id: "DIAG", lines: [], total: 0 } }) }); out.post = res.status; } catch (e) { out.postError = String(e); }
        try { const res = await fetch(`${cfg.baseUrl}/c/${cfg.appId}/content.json`); out.content = res.status; } catch (e) { out.contentError = String(e); }
        return out;
      });
      return { diag: r, screen: await screen(page) };
    }
    case "device_reset": await page.evaluate((d) => globalThis.__pnDevice?.reset(d), body.device ?? {}); await syncMedia(page); s.shade.open = "none"; break;
    // Uncaught page errors since the last call to this action. Reading them clears the list.
    case "errors": return { errors: s.errors.splice(0), screen: await screen(page) };
    // Rendered size in CSS px of each ref on the current screen: { sizes: { ref: [width, height] } }. Refs that are gone are left out.
    case "sizes": {
      const text = await screen(page); const sizes = {};
      for (const m of text.matchAll(/\[ref=(\w+)\]/g)) {
        const raw = m[1].replace(/^p\d+(?=e\d+$)/, "");
        const box = await page.locator(`aria-ref=${raw}`).first().boundingBox().catch(() => null);
        if (box) sizes[m[1]] = [Math.round(box.width * 10) / 10, Math.round(box.height * 10) / 10];
      }
      return { sizes, screen: text };
    }
    case "back": { if (s.shade.open !== "none") { s.shade.open = "none"; break; } const b = page.getByRole("button", { name: "Back", exact: true }); if (await b.count()) { await ready(b.first()); await b.first().click(); } else throw new Error("no Back button on this screen"); break; }
    case "screenshot": {
      // format "jpeg" has no alpha channel, which the stores require. inline: true also returns the bytes as base64 for clients on another machine.
      const jpeg = body.format === "jpeg"; const p = join(DIR, `${id}-${Date.now()}.${jpeg ? "jpg" : "png"}`);
      // Home screen or switcher showing: draw it over the app for the shot, then take it away. The app stays loaded underneath.
      const away = s.nav.where !== "app";
      if (away) await page.evaluate((h) => { const d = document.createElement("div"); d.id = "__pn_away"; d.innerHTML = h; document.body.appendChild(d); }, awayScreenHtml(s.nav.where, APP_NAME));
      let buf; try { buf = await page.screenshot(jpeg ? { path: p, type: "jpeg", quality: 90 } : { path: p }); } finally { if (away) await page.evaluate(() => document.getElementById("__pn_away")?.remove()); }
      return { path: p, ...(body.inline ? { data: buf.toString("base64") } : {}), screen: await screen(page) };
    }
    default: throw new Error(`unknown action '${body.action}'. Actions: screen, get_update_state, check_for_update, apply_update, install_app, uninstall_app, switch_app, lock, unlock, restart, press_home, open_recents, resume_app, kill_app, open_notifications, open_control_center, close_panels, toggle_tile, dismiss_notification, get_settings, set_setting, tap, locate, type, scroll, back, screenshot, set_device, push_notification, notifications, open_notification, open_url, errors, sizes, device_log, device_reset, set_network_mocks, set_network_profile, browser_open, browser_snapshot, browser_click, browser_type, browser_back, browser_screenshot, browser_tabs, browser_close_tab, browser_scroll, browser_wait_for`);
  }
  return { ...(["tap", "scroll", "back"].includes(body.action) ? { delivery: "delivered" } : {}), screen: await screen(page) };
}

const DELIVERY = new Set(["tap", "type", "scroll", "back"]);
const REASONS = new Set(["stale_ref", "not_visible", "disabled", "covered"]);
const WCACHE = new Map();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  // CORS plus Chromium's private-network preflight: the app page comes from the public control plane (https) and
  // posts orders and telemetry to this loopback backend.
  const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-private-network": "true" };
  const send = (code, obj, type = "application/json") => { res.writeHead(code, { "content-type": type, ...CORS }); res.end(type === "application/json" ? JSON.stringify(obj) : obj); };
  try {
    if (req.method === "OPTIONS") return send(204, "", "text/plain");
    // the app's static web build
    if (url.pathname.startsWith("/_expo/") || url.pathname.startsWith("/assets/") || url.pathname === "/favicon.ico") {
      const p = join(DIST, decodeURIComponent(url.pathname)); if (existsSync(p)) return send(200, readFileSync(p), MIME[extname(p)] ?? "application/octet-stream");
    }
    // released web artifacts, proxied from the control plane and cached (immutable per release)
    if (url.pathname.startsWith("/w/")) {
      const key = url.pathname; let hit = WCACHE.get(key);
      if (!hit) { const r = await fetch(`${CONTROL}${key}`); if (!r.ok) return send(r.status, { error: "artifact" }); hit = { type: r.headers.get("content-type") ?? "application/octet-stream", body: Buffer.from(await r.arrayBuffer()) }; WCACHE.set(key, hit); }
      return send(200, hit.body, hit.type);
    }
    // a bundle this session downloaded and verified: the page that runs is the page that was checked
    { const um = url.pathname.match(/^\/u\/([\w-]+)\/r(\d+)\/index\.html$/);
      if (um) { const b = sessions.get(um[1])?.update.bundles.get(Number(um[2])); return b ? send(200, b, MIME[".html"]) : send(404, { error: "no_bundle" }); } }
    // a founder opening the printed link lands on the app
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/") { res.writeHead(302, { location: "/app/", ...CORS }); return res.end(); }
    { const bm = url.pathname.match(/^\/b\/([0-9a-f]{64})\/(.*)$/);
      if (bm) {
        const root = BUILDS.get(bm[1]); if (!root) return send(404, { error: "no_build" });
        let p = join(root, decodeURIComponent(bm[2]) || "index.html");
        if (p !== root && !p.startsWith(root + sep)) return send(404, { error: "no_build" });
        if (!existsSync(p) || statSync(p).isDirectory()) p = join(root, "index.html");
        if (extname(p) === ".html") return send(200, withAppName(readFileSync(p, "utf8"), APP_NAME), MIME[".html"]);
        return send(200, readFileSync(p), MIME[extname(p)] ?? "application/octet-stream");
      } }
    if (url.pathname.startsWith("/app/")) {
      let p = join(DIST, url.pathname.slice(5) || "index.html"); if (!existsSync(p) || statSync(p).isDirectory()) p = join(DIST, "index.html");
      if (extname(p) === ".html") return send(200, withAppName(readFileSync(p, "utf8"), APP_NAME), MIME[".html"]);
      return send(200, readFileSync(p), MIME[extname(p)] ?? "application/octet-stream");
    }
    // mock control plane per session
    const m = url.pathname.match(/^\/s\/(~?[\w-]+)\/(.*)$/);
    if (m) {
      const [, id, rest] = m;
      if (rest.startsWith("c/")) {
        // Use the same live content as devices when CONTENT_FROM points at a control plane; else the bundled default.
        if (process.env.CONTENT_FROM) { try { const r = await fetch(`${process.env.CONTENT_FROM}/${rest}`); if (r.ok) { res.writeHead(200, { "content-type": "application/json", ...CORS }); return res.end(await r.text()); } } catch {} }
        return send(404, { error: "no_content" });
      }
      if (rest === "orders" && req.method === "GET") { try { return send(200, JSON.parse(readFileSync(join(DIR, `${id}.json`), "utf8"))); } catch { return send(404, { error: "no_session" }); } }
      if (rest.startsWith("o/") && req.method === "POST") {
        let b = ""; for await (const ch of req) b += ch;
        const f = join(DIR, `${id}.json`); const st = JSON.parse(readFileSync(f, "utf8")); st.orders.push(JSON.parse(b).order); writeFileSync(f, JSON.stringify(st));
        return send(202, { ok: true });
      }
      return send(202, { ok: true }); // telemetry etc.
    }
    // the Browser app, in a phone frame
    if (req.method === "GET" && url.pathname === "/browser") return send(200, browserAppPage(url.searchParams.get("skin") === "ios" ? "ios" : "android", url.searchParams.get("session") ?? ""), MIME[".html"]);
    if (req.method === "GET" && url.pathname === "/watch") { const list = watchList(sessions); const want = url.searchParams.get("skin"); return send(200, watchPage(want ?? (url.searchParams.get("session") ? sessions.get(url.searchParams.get("session"))?.skin : null) ?? list[0]?.skin, url.searchParams.get("session") ?? "", { hosted: url.searchParams.get("hosted") === "1", takeOver: url.searchParams.get("takeover") === "1", signin: url.searchParams.get("signin") ?? "" }), MIME[".html"]); }
    // agent API
    if (req.method !== "POST") return send(404, { error: "not found" });
    let raw = ""; for await (const ch of req) raw += ch; const body = raw ? JSON.parse(raw) : {};
    if (url.pathname === "/apps") return send(200, { ok: true, apps: [{ id: DEFAULT_APP, name: APP_NAME }] });
    if (url.pathname === "/sessions") return send(200, { ok: true, sessions: await Promise.all([...sessions.entries()].map(async ([id, s]) => ({ session: id, app: s.app, release: s.release, started_at: s.startedAt ?? null, skin: s.skin, streaming: isWatched(s) || !!s.browser?.screencast, url: s.page.url(), room: s.room ?? null, title: await s.page.title().catch(() => "") }))) });
    if (url.pathname === "/end") return send(200, { ok: true, ended: await endSession(String(body.session)) });
    if (url.pathname === "/session") { try { await newSession(body.session, body); } catch (e) { if (e instanceof BuildCacheError || (e instanceof SimError && (e.code === "bad_profile" || e.code === "bad_room" || e.code === "bad_app"))) return send(200, { ok: false, code: e.code, error: e.message }); throw e; } const s = sessions.get(body.session); log(body.session, "start", true, { app: s.app, release: s.release }); return send(200, { ok: true, app: s.app, release: s.release, ...(s.build ? { build: s.build } : {}), screen: await screen(s.page) }); }
    if (url.pathname === "/act") {
      try { const s0 = sessions.get(body.session); const prevScreen = s0?.lastScreen; const r = await act(body.session, body);
        if (s0 && typeof r.screen === "string") { s0.lastScreen = r.screen; watch.step(body.session, describeStep(body, prevScreen), changeLine(prevScreen, r.screen)); }
        log(body.session, body.action, true, body.ref ? { ref: body.ref } : {}); return send(200, { ok: true, ...r }); }
      catch (e) { log(body.session, body.action, false); const s = sessions.get(body.session); return send(200, { ok: false, error: String(e.message).split("\n")[0], ...(e.code ? { code: e.code } : {}), ...(DELIVERY.has(body.action) && REASONS.has(e.code) ? { delivery: "not_delivered", reason: e.code, safe_to_retry: true } : {}), screen: s ? await screen(s.page) : null }); }
    }
    send(404, { error: "not found" });
  } catch (e) { send(500, { error: String(e) }); }
});
// Take over: a viewer who turned it on sends taps, swipes and typing to the app page.
const watch = createWatch(sessions, acceptWebSocket, async (id, m) => {
  const { page } = sessions.get(id) ?? {}; if (!page) return null;
  const num = (...v) => { if (!v.every((n) => Number.isFinite(n))) throw new Error("coordinates must be numbers"); };
  if (m.type === "tap") { num(m.x, m.y); await page.mouse.click(m.x, m.y); return "You tapped the screen"; }
  if (m.type === "swipe") { num(m.x1, m.y1, m.x2, m.y2); await page.mouse.move(m.x1, m.y1); await page.mouse.wheel(m.x1 - m.x2, m.y1 - m.y2); return "You scrolled"; }
  if (m.type === "text") { await page.keyboard.type(String(m.text ?? "").slice(0, 2000)); return `You typed "${String(m.text ?? "").slice(0, 40)}"`; }
  if (m.type === "key" && ["Enter", "Backspace", "Tab"].includes(m.key)) { await page.keyboard.press(m.key); return `You pressed ${m.key}`; }
  return null;
});
// The Browser app's live view: frames out, taps, swipes and typing in. Same trust as the HTTP API (loopback), plus an Origin check
// so another web page open on this machine cannot drive the phone.
server.on("upgrade", (req, socket) => {
  const url = new URL(req.url, "http://x");
  const refuse = (line) => socket.end(`HTTP/1.1 ${line}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  if (url.pathname !== "/browser/ws" && url.pathname !== "/watch/ws") return refuse("404 Not Found");
  let originHost = null; try { if (req.headers.origin) originHost = new URL(req.headers.origin).host; } catch { originHost = "invalid"; }
  // A missing Origin is allowed (non-browser clients). The Host comparison does not stop DNS rebinding, since both
  // values come from the requester; the HTTP API has the same trust level.
  if (originHost && originHost !== req.headers.host) return refuse("403 Forbidden");
  if (url.pathname === "/watch/ws") return watch.upgrade(req, socket, url);
  const s = sessions.get(url.searchParams.get("session") ?? ""); if (!s) return refuse("404 Not Found");
  const peer = acceptWebSocket(req, socket, async (text) => {
    let m; try { m = JSON.parse(text); } catch { return; }
    const b = s.browser;
    try {
      if (m.type === "open") { await openInBrowserApp(url.searchParams.get("session"), String(m.url)); return; }   // a refusal reaches every viewer as an `error` message
      if (!b) return;
      if (m.type === "back") await b.back(); else if (m.type === "forward") await b.forward(); else if (m.type === "reload") await b.reload();
      else if (m.type === "tab") await b.selectTab(Number(m.index)); else if (m.type === "newtab") await b.newTab(); else if (m.type === "closetab") await b.closeTab(Number(m.index));
      else await b.input(m);
    } catch (e) { peer.send(JSON.stringify({ type: "error", code: e.code ?? "error", message: String(e.message).split("\n")[0] })); }
  }, () => { s.peers?.delete(peer); if (!s.peers?.size) s.browser?.stopScreencast(); });
  if (!peer) return;
  s.peers = s.peers ?? new Set(); s.peers.add(peer);
  peer.send(JSON.stringify({ type: "hello", browser: !!s.browser }));
  ensureCast(s);
});
// Agents and parity runs pause between actions; keep idle connections open well beyond Node's 5 s default.
server.keepAliveTimeout = 300_000; server.headersTimeout = 310_000; server.requestTimeout = 0;
server.listen(PORT, () => console.log(`Shipvo UI simulator on http://localhost:${PORT} (sessions in ${DIR})`));
launchBrowser();
