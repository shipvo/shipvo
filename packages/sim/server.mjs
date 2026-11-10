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
import { parseMockRules } from "./mock-rules.mjs";
import { createInbox, InboxError, INBOX_DOMAIN } from "./inbox.mjs";
import { applyProfile, getProfile } from "./network-profiles.mjs";
import { installNetGate } from "./net-gate.mjs";
import { pushNotification } from "./push-notification.mjs";
import { createSecretsForward, isVaultUiPath } from "./secrets-forward.mjs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { resolveBrowser } from "./browser-resolver.mjs";
import { PhoneBrowser, BrowserError, checkUrl } from "./phone-browser.mjs";
import { acceptWebSocket } from "./ws-lite.mjs";
import { phonePage } from "./phone-page.mjs";
import { createWatch, watchPage, watchList, closeWatchers, isWatched, describeStep, changeLine } from "./watch.mjs";
import { browserAppPage } from "./browser-app.mjs";
import { launchErrorMessage } from "./chromium-hint.mjs";
import { shadeAction, SHADE_ACTIONS } from "./shade-actions.mjs";
import { settingsAction, syncMedia, SETTINGS_ACTIONS } from "./settings-actions.mjs";
import { SettingsError } from "./settings.mjs";
import { SpecHost } from "./spec-host.mjs";
import { fetchBuild, BuildCacheError } from "./build-cache.mjs";
import { AppsError, DEVICE_PERMISSIONS, setPermission, exportProfile, loadProfile, resolveUrl, profilePatch, installApp, findApps, uninstallApp, switchApp, describeApps, pinApp, hideApp, arrangeApp, cleanPlacement, installedIconsHtml, storeCss } from "./apps.mjs";
import { UpdateError, createUpdate, checkForUpdate, applyUpdate, bootDone, updateView, bannerText } from "./update.mjs";
import { ShadeError } from "./shade.mjs";
import { createNav, pressHome, openRecents, resume, killApp, assertForeground, setVisibilityInPage, awayScreenHtml, NavError } from "./nav.mjs";
import { assistantName } from "./identity.mjs";
import { pendingBanner, waitForNew } from "./banner.mjs";
import { createWakeups, WakeupError } from "./wakeup.mjs";
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
// The room log sits beside the shared store: what each session did and the notes agents post. Cursors are entry numbers.
const roomLogs = new Map();   // room -> { n, entries }
const NOTE_MAX = 500, LOG_MAX = 1000;
function roomLog(room, e) {
  const l = roomLogs.get(room) ?? roomLogs.set(room, { n: 0, entries: [] }).get(room);
  l.entries.push({ n: ++l.n, at: new Date().toISOString(), ...e });
  if (l.entries.length > LOG_MAX) l.entries.splice(0, l.entries.length - LOG_MAX);
}
function leaveRoom(s, id) {
  if (!s.room) return;
  const set = rooms.get(s.room); set?.delete(id);
  if (!set?.size) { rooms.delete(s.room); roomLogs.delete(s.room); try { rmSync(join(DIR, `${backendOf(id, s.room)}.json`), { force: true }); rmSync(join(DIR, `${backendOf(id, s.room)}.json.log`), { force: true }); } catch {} }
}
async function endSession(id) {
  const s = sessions.get(id); if (!s) return false;
  specHost.dropSession(id);
  for (const p of s.peers ?? []) p.close(); closeWatchers(s);
  await (await s.browserP?.catch(() => undefined))?.close(); await s.ctx.close().catch(() => {});
  s.inbox?.close(); s.wakeups?.close(); sessions.delete(id); leaveRoom(s, id); return true;
}
async function newSession(id, opts = {}) {
  const room = opts.room == null ? undefined : String(opts.room);
  if (room !== undefined && !/^[\w-]{1,64}$/.test(room)) throw new SimError("bad_room", "room must be 1 to 64 letters, digits, _ or -");
  if (sessions.has(id)) { specHost.dropSession(id); const old = sessions.get(id); for (const p of old.peers ?? []) p.close(); closeWatchers(old); await (await old.browserP?.catch(() => undefined))?.close(); await old.ctx.close().catch(() => {}); old.inbox?.close(); old.wakeups?.close(); sessions.delete(id); leaveRoom(old, id); }
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
  // Share.share records the share on the session, so it survives the app switch that follows it. Read and clear it with read_share.
  await ctx.exposeFunction("__pnShareRecorded", (sh) => { const s = sessions.get(id); if (s) s.pendingShare = sh; });
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
  if (apps.network) { try { getProfile(apps.network); } catch (e) { await ctx.close(); throw new SimError("bad_profile", `phone.json: ${e.message}`); } }
  sessions.set(id, { pageErrors, update: createUpdate({ release: target.release, url: target.url }), updateSrc: { url: opts.update_url ?? UPDATE.url, key: opts.update_key ?? UPDATE.key }, apps, ctx, page, errors, app: target.app, release: target.release, room, skin: opts.skin === "ios" ? "ios" : "android", startedAt: new Date().toISOString(), life: createLifecycle(), shade: { open: "none" }, nav: createNav(), inbox: createInbox() });
  await ensureNetworkRoute(sessions.get(id), page);   // the mail sink answers from the first page load
  if (buildId) sessions.get(id).build = buildId;
  if (apps.network && apps.network !== "online") await setNetworkProfile(sessions.get(id), page, apps.network);
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
const specHost = new SpecHost();
/** One answer per device permission a spec declares: the person's (`given`), or allowed when none was given. */
const declaredAnswers = (spec, given) => Object.fromEntries((Array.isArray(spec?.permissions?.device) ? spec.permissions.device : []).filter((p) => DEVICE_PERMISSIONS.includes(p)).map((p) => [p, typeof given?.[p] === "boolean" ? given[p] : true]));
// The phone's clock: the real time, or the time a test set with set_time.
const nowOf = (s) => (s.clockMs != null ? new Date(s.clockMs) : new Date());
const sidOf = (s) => [...sessions].find(([, v]) => v === s)?.[0];
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
async function switchToApp(s, page, id, fresh = false) {
  const url = s.apps.installed_apps.find((a) => a.id === id)?.url ?? "";
  // fixture: pages are stand-ins (no navigation). app://<id>[@rN] loads a published release like open_app. Anything else
  // must pass the same private-host guard as the Browser app, so a profile cannot point Chromium at the local network.
  let dest = null;
  const am = /^app:\/\/([a-z0-9-]+(?:@(?:r?\d+|latest))?)$/.exec(url);
  const sm = /^spec:\/\/([a-z0-9-]+)$/.exec(url);
  if (sm) { if (!specHost.has(sidOf(s), sm[1])) throw new SimError("not_installed", `the spec app '${sm[1]}' is not running on this phone`); dest = `http://localhost:${PORT}/spec/${encodeURIComponent(sidOf(s))}/${sm[1]}/`; }
  else if (am) dest = (await resolveApp(am[1])).url;
  else if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^fixture:/i.test(url)) {
    try { dest = (await checkUrl(url, { allowPrivate: false, allowHosts: [] })).href; }
    catch (e) { if (e instanceof BrowserError) throw new SimError(e.code, e.message); throw e; }
  }
  switchApp(s.apps, id, s.nav);
  if (dest && (fresh || page.url() !== dest)) { await page.goto(dest, { waitUntil: "networkidle" }); await page.waitForTimeout(300); }
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
    if (req.url().startsWith(`https://${INBOX_DOMAIN}/send`)) return deliverSink(s, req, route);
    const rule = (s.mocks ?? []).find((m) => (!m.method || m.method === req.method()) && m.match(req.url()));
    if (rule) {
      if (rule.mail) s.inbox?.deliver(rule.mail);
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

// The app's outgoing mail: POST https://inbox.shipvo.test/send with JSON { to, from, subject, text }. Only the session's own
// address is delivered to; any other address gets 550 and nothing is kept.
async function deliverSink(s, req, route) {
  const reply = (status, o) => route.fulfill({ status, body: JSON.stringify(o), headers: { "content-type": "application/json", "access-control-allow-origin": "*" } }).catch(() => {});
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST" } }).catch(() => {});
  let m; try { m = JSON.parse(req.postData() ?? ""); } catch { return reply(400, { ok: false, error: "send needs a JSON body { to, from, subject, text }" }); }
  if (!m || typeof m !== "object" || String(m.to ?? "").trim().toLowerCase() !== s.inbox.address) return reply(550, { ok: false, error: "no such mailbox" });
  s.inbox.deliver(m);
  return reply(202, { ok: true });
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

/** Which parts of an imported layout were rejected, as path suffixes with the reason. Valid input that is only normalised (true to 1, default times, "Sat" to "sat") is not reported. */
function droppedPlacement(raw, cleaned) {
  if (raw == null) return [];
  if (typeof raw !== "object" || Array.isArray(raw)) return [": not valid, ignored (expected an object)"];
  const out = [];
  for (const k of Object.keys(raw)) {
    if (!["pinned", "hidden", "position", "schedule"].includes(k)) out.push(`.${k}: not recognised, ignored`);
    else if (raw[k] == null || ((k === "pinned" || k === "hidden") && raw[k] === false)) continue;
    else if (!cleaned || !(k in cleaned)) out.push(`.${k}: not valid, dropped`);
  }
  return out;
}

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
      return { where, appState: where === "app" ? "active" : "background", reloads: s.life.reloads, screen: where === "app" ? await screen(page) : where === "home" ? `Home screen\n- button "${APP_NAME}" (the app icon: resume_app opens it)\n${describeApps(s.apps, nowOf(s))}` : `App switcher\n- card "${APP_NAME}" (resume_app opens it, kill_app closes it)` };
    }
    // Describe an app and it appears: a spec is validated, started and installed with an icon on the home screen.
    case "create_app": {
      const appId = String(body.id ?? "");
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(appId)) throw new SimError("bad_app_id", "id: lowercase letters, digits and dashes, up to 40, starting with a letter or digit");
      if (s.apps.installed_apps.some((a) => a.id === appId)) throw new SimError("already_installed", `'${appId}' is already installed. Uninstall it with uninstall_app first.`);
      const perms = declaredAnswers(body.spec, body.permissions);
      const made = specHost.create(sidOf(s), appId, body.spec, { style: body.style === "ios" ? "ios" : "android", permissions: perms });
      if (!made.ok) throw new SimError("invalid_spec", made.errors.slice(0, 20).map((e) => `${e.path || "/"}: ${e.message}${e.fix ? ` (${e.fix})` : ""}`).join("\n"));
      const nm = String(body.name ?? body.spec?.app?.name ?? appId).replace(/[<>"'\\]/g, "").slice(0, 40);
      s.apps.installed_apps.push({ id: appId, name: nm, url: `spec://${appId}`, version: "1", kind: "spec", ...(Object.keys(perms).length ? { permissions: perms } : {}) });
      s.apps.log.push({ at: Date.now(), name: "create_app", app: appId, source: "real", version: "1" });
      if (body.open !== false) {
        // If opening fails, the app is not left installed or running.
        try { await switchToApp(s, page, appId, true); }
        catch (e) { s.apps.installed_apps = s.apps.installed_apps.filter((a) => a.id !== appId); s.apps.log = s.apps.log.filter((l) => !(l.app === appId && l.name === "create_app")); specHost.drop(sidOf(s), appId); throw e; }
      }
      return { where: s.nav.where, current_app: s.apps.current_app, installed_apps: s.apps.installed_apps, warnings: made.warnings, screen: s.nav.where === "app" ? await screen(page) : `Home screen\n${describeApps(s.apps, nowOf(s))}` };
    }
    // Home screen layout: pin, hide, reorder and schedule an installed app.
    case "schedule_app": case "clear_schedule":   // the same schedule as arrange_apps, under the names an assistant looks for
    case "arrange_apps": {
      const { id: appId, ...rest } = body; delete rest.action; delete rest.session;
      const patch = body.action === "clear_schedule" ? { schedule: null } : body.action === "schedule_app" ? { schedule: { days: body.days, from: body.from, to: body.to, timezone: body.timezone } } : rest;
      try { arrangeApp(s.apps, String(appId ?? ""), patch, body.action); } catch (e) { if (e instanceof AppsError) throw new SimError(e.code, e.message); throw e; }
      return { installed_apps: s.apps.installed_apps, home: `Home screen\n${describeApps(s.apps, nowOf(s))}`, screen: s.nav.where === "app" ? await screen(page) : `Home screen\n${describeApps(s.apps, nowOf(s))}` };
    }
    // The phone's clock, for schedules. at: an ISO time like 2026-11-14T09:00:00, or null for the real time.
    case "set_time": {
      if (body.at == null) s.clockMs = null;
      else { const t = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/.test(String(body.at)) ? Date.parse(String(body.at)) : NaN; if (Number.isNaN(t)) throw new SimError("bad_time", "at must be a time like 2026-11-14T09:00:00, or null"); s.clockMs = t; }
      return { now: nowOf(s).toString(), home: `Home screen\n${describeApps(s.apps, nowOf(s))}`, screen: s.nav.where === "app" ? await screen(page) : `Home screen\n${describeApps(s.apps, nowOf(s))}` };
    }
    // Copy every spec app out of the phone: spec, style, collection data and settings. Vault values are never held by the phone, so none can appear.
    case "export_apps": {
      const want = Array.isArray(body.ids) ? body.ids.map(String) : null;
      const specs = s.apps.installed_apps.filter((a) => a.kind === "spec");
      if (want) for (const w of want) if (!specs.some((a) => a.id === w)) throw new SimError("not_installed", `'${w}' is not a spec app on this phone`);
      const apps = specs.filter((a) => !want || want.includes(a.id)).map((a) => ({ id: a.id, name: a.name, ...specHost.snapshot(sidOf(s), a.id), ...(a.placement ? { placement: a.placement } : {}), ...(a.permissions ? { permissions: { ...a.permissions } } : {}) }));
      return { format: "shipvo.phone-apps/v0", apps };
    }
    // Put exported apps on the phone. Every spec is checked first and nothing is installed if any is wrong.
    case "import_apps": {
      const list = Array.isArray(body.apps) ? body.apps : Array.isArray(body.export?.apps) ? body.export.apps : null;
      if (!list) throw new SimError("invalid_spec", "apps: expected the JSON from export_phone_apps (an array of apps)");
      const problems = []; const seen = new Set();
      list.forEach((a, i) => {
        const at = `apps[${i}]`;
        if (!a || typeof a !== "object") return problems.push(`${at}: expected an object`);
        if (typeof a.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(a.id)) problems.push(`${at}.id: lowercase letters, digits and dashes, up to 40`);
        else if (seen.has(a.id)) problems.push(`${at}.id: '${a.id}' appears twice`); else seen.add(a.id);
        const style = a.style === "ios" ? "ios" : "android";
        const c = specHost.check(a.spec, style);
        if (!c.ok) for (const e of c.errors.slice(0, 20)) problems.push(`${at}.spec${(e.path || "").replace(/^\$/, "")}: ${e.message}${e.fix ? ` (${e.fix})` : ""}`);
        else if (a.data != null && typeof a.data !== "object") problems.push(`${at}.data: expected an object`);
        else if (a.settings != null && typeof a.settings !== "object") problems.push(`${at}.settings: expected an object`);
      });
      if (problems.length) throw new SimError("invalid_spec", problems.join("\n"));
      if (body.replace !== true) for (const a of list) if (s.apps.installed_apps.some((x) => x.id === a.id)) throw new SimError("already_installed", `'${a.id}' is already installed. Pass replace: true to overwrite it.`);
      for (const a of list) { const ex = s.apps.installed_apps.find((x) => x.id === a.id); if (ex && ex.kind !== "spec") throw new SimError("already_installed", `'${a.id}' is an installed store app and cannot be replaced.`); }
      const warnings = [];
      for (const a of list) {
        const ex = s.apps.installed_apps.find((x) => x.id === a.id);
        if (ex) { uninstallApp(s.apps, a.id, s.nav); specHost.drop(sidOf(s), a.id); }
        const perms = declaredAnswers(a.spec, a.permissions);
        const made = specHost.create(sidOf(s), a.id, a.spec, { style: a.style === "ios" ? "ios" : "android", data: a.data ?? undefined, state: a.settings ?? undefined, permissions: perms });
        const nm = String(a.name ?? a.spec?.app?.name ?? a.id).replace(/[<>"'\\]/g, "").slice(0, 40);
        const placement = a.placement == null ? null : cleanPlacement(a.placement);
        for (const w of droppedPlacement(a.placement, placement)) warnings.push(`apps[${list.indexOf(a)}].placement${w}`);
        s.apps.installed_apps.push({ id: a.id, name: nm, url: `spec://${a.id}`, version: "1", kind: "spec", ...(placement ? { placement } : {}), ...(Object.keys(perms).length ? { permissions: perms } : {}) });
        s.apps.log.push({ at: Date.now(), name: "import_apps", app: a.id, source: "real", version: "1", replaced: !!ex });
      }
      return { imported: list.map((a) => a.id), installed_apps: s.apps.installed_apps, ...(warnings.length ? { warnings } : {}), screen: s.nav.where === "app" ? await screen(page) : `Home screen\n${describeApps(s.apps, nowOf(s))}` };
    }
    // Edit in place: a new spec is a new version. Data and state the person entered carry over; a bad spec changes nothing.
    // Fetch a spec app's http data sources now. Reloads the open screen only when the data changed.
    case "refresh_app": {
      const appId = String(body.id ?? "");
      if (!specHost.has(sidOf(s), appId)) throw new SimError("not_installed", `'${appId}' is not a spec app running on this phone`);
      const out = await specHost.refresh(sidOf(s), appId);
      s.apps.log.push({ at: Date.now(), name: "data_refresh", app: appId, sources: out.updated, errors: out.errors.map((e) => e.source), source: "real" });
      const open = s.apps.current_app === appId && s.nav.where === "app";
      if (out.updated.length && open) { await page.reload({ waitUntil: "networkidle" }); await reapplyNetProfile(s, page); }
      return { updated: out.updated, errors: out.errors, ...(open ? { screen: await screen(page) } : {}) };
    }
    case "update_app": {
      const appId = String(body.id ?? "");
      const entry = s.apps.installed_apps.find((a) => a.id === appId);
      if (!entry || entry.kind !== "spec") throw new SimError("not_installed", `'${appId}' is not a spec app on this phone. Use create_app first.`);
      const up = specHost.update(sidOf(s), appId, body.spec);
      if (!up.ok) throw new SimError("invalid_spec", up.errors.slice(0, 20).map((e) => `${e.path || "/"}: ${e.message}${e.fix ? ` (${e.fix})` : ""}`).join("\n"));
      entry.version = String(up.version);
      // A new version may ask for other device permissions: new ones start allowed (as on install), kept ones keep the person's answer, dropped ones go.
      const perms = declaredAnswers(body.spec, entry.permissions);
      if (Object.keys(perms).length) entry.permissions = perms; else delete entry.permissions;
      specHost.syncPermissions(sidOf(s), appId, perms);
      if (typeof body.name === "string" && body.name.trim()) entry.name = body.name.replace(/[<>"'\\]/g, "").slice(0, 40);
      s.apps.log.push({ at: Date.now(), name: "update_app", app: appId, from: String(up.from), version: String(up.version), changes: specHost.history(sidOf(s), appId).at(-1)?.changes ?? [], source: "real" });
      if (s.apps.current_app === appId && s.nav.where === "app") { await page.reload({ waitUntil: "networkidle" }); await reapplyNetProfile(s, page); }
      return { version: up.version, installed_apps: s.apps.installed_apps, warnings: up.warnings, screen: s.apps.current_app === appId && s.nav.where === "app" ? await screen(page) : undefined };
    }
    // What was built and changed on the phone: for each spec app its versions with what changed, its live sources and its events.
    case "app_activity": {
      const only = body.id ? String(body.id) : null;
      const sid = sidOf(s);
      const apps = s.apps.installed_apps.filter((a) => a.kind === "spec" && (!only || a.id === only));
      if (only && !apps.length) throw new SimError("not_installed", `'${only}' is not a spec app on this phone`);
      const limit = Math.max(1, Math.min(200, Number(body.limit) || 50));
      return { apps: apps.map((a) => ({
        id: a.id, name: a.name, version: specHost.version(sid, a.id) ?? (Number(a.version) || 1),
        history: specHost.history(sid, a.id), sources: specHost.sources(sid, a.id),
        events: s.apps.log.filter((e) => e.app === a.id && e.source === "real").slice(-limit),
      })) };
    }
    // Arrange the home screen: pinned apps lead, hidden apps leave the home screen and app list but keep their data.
    case "pin_app": case "hide_app": {
      const id = String(body.id ?? "");
      try { (body.action === "pin_app" ? pinApp : hideApp)(s.apps, id, body.action === "pin_app" ? body.pinned !== false : body.hidden !== false); }
      catch (e) { if (e instanceof AppsError) throw new SimError(e.code, e.message); throw e; }
      return { current_app: s.apps.current_app, installed_apps: s.apps.installed_apps, screen: s.nav.where === "app" ? await screen(page) : `Home screen\n${describeApps(s.apps, nowOf(s))}` };
    }
    // Run one action of a spec app by name, the way a generated tool does. The open screen shows the result.
    case "app_action": {
      const appId = String(body.id ?? "");
      if (!specHost.has(sidOf(s), appId)) throw new SimError("not_installed", `'${appId}' is not a spec app running on this phone`);
      const res = specHost.call(sidOf(s), appId, String(body.action_name ?? ""), body.input && typeof body.input === "object" ? body.input : {}, { caller: assistantName(body.agent) });
      s.apps.log.push({ at: Date.now(), name: "app_action", app: appId, action: String(body.action_name ?? ""), source: "real", ...(body.agent ? { caller: assistantName(body.agent) } : {}) });
      if (s.apps.current_app === appId && s.nav.where === "app") { await page.reload({ waitUntil: "networkidle" }); await reapplyNetProfile(s, page); }
      if (res.ok === false && /^permission_denied:/.test(res.error)) throw new SimError("permission_denied", res.error.replace(/^permission_denied:\s*/, ""));
      if (res.ok === false) throw new SimError("action_failed", res.error);
      return { value: res.value ?? null, screen: s.apps.current_app === appId && s.nav.where === "app" ? await screen(page) : undefined };
    }
    // Installed apps. Errors are typed: unknown_app, already_installed, not_installed. Logged in device_log: source "real" (with the bundle sha256) for a fetched bundle, "simulated" for a fixture app.
    // One toggle per app and permission, the same as the Settings screen.
    case "set_app_permission": {
      const id = String(body.id ?? "");
      try { setPermission(s.apps, id, String(body.permission ?? ""), body.allowed); } catch (e) { if (e instanceof AppsError) throw new SimError(e.code, e.message); throw e; }
      specHost.setPermission(sidOf(s), id, String(body.permission), body.allowed);
      // `profile` is the phone.json form of the phone with these answers: save it and start a new session with it (phone) to keep them.
      // A Store app (not a spec app) has no running host, so its answer is stored and enforces nothing until it runs.
      return { id, permissions: s.apps.installed_apps.find((a) => a.id === id).permissions, installed_apps: s.apps.installed_apps, profile: exportProfile(s.apps) };
    }
    case "install_app": case "uninstall_app": case "switch_app": {
      const id = String(body.id ?? "");
      let installed;
      try {
        if (body.action === "install_app") {
          const catalog = Array.isArray(body.catalog) ? body.catalog : s.apps.store;
          const found = catalog.find((a) => a?.id === id);
          if (found && s.apps.installed_apps.some((a) => a.id === id)) throw new AppsError("already_installed", `'${id}' is already installed`);   // before any download
          // A listing with a real URL is fetched first: the install keeps the bundle's sha256 and size, and fails if the bundle cannot be fetched.
          const real = found && !/^fixture:/i.test(String(found.url ?? "")) ? await fetchAppBundle(found) : undefined;
          installApp(s.apps, id, catalog, real, body.permissions);
          installed = s.apps.installed_apps.find((a) => a.id === id);
        }
        else if (body.action === "uninstall_app") { uninstallApp(s.apps, id, s.nav); specHost.drop(sidOf(s), id); }
        else {
          await switchToApp(s, page, id);
        }
      } catch (e) { if (e instanceof AppsError) throw new SimError(e.code, e.message); throw e; }
      if (body.action === "uninstall_app" && s.nav.where === "home") await page.evaluate(setVisibilityInPage, "background");
      const where = s.nav.where;
      return { where, current_app: s.apps.current_app, installed_apps: s.apps.installed_apps, ...(installed ? { declared: installed.declared ?? [], permissions: installed.permissions ?? {} } : {}), screen: where === "app" ? await screen(page) : `Home screen\n${describeApps(s.apps, nowOf(s))}` };
    }
    // Read-only: what a frame page needs to draw this phone's home screen and Store. Not in device_log.
    case "phone_apps": return { now: nowOf(s).getTime(), where: s.nav.where, current_app: s.apps.current_app, installed_apps: s.apps.installed_apps, store: s.apps.store, locked: s.life.locked, skin: s.skin, screen: null };
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
    case "read_share": { const share = s.pendingShare ?? null; if (body.clear !== false) s.pendingShare = null; return { share }; }
    case "receive_share": {
      for (const k of ["message", "url"]) if (body[k] !== undefined && typeof body[k] !== "string") throw new SimError("bad_share", `${k} must be a string`);
      if (!body.message && !body.url) throw new SimError("empty_share", "receive_share needs a message or a url");
      const handled = await page.evaluate((p) => globalThis.__pnDevice?.receiveShare(p), { message: body.message, url: body.url }); await page.waitForTimeout(400); return { handled: !!handled }; }
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
    // The line MCP puts at the start of every tool result: what waits for the calling assistant in the Assistant Inbox app. Changes nothing.
    case "pending_banner": return { banner: pendingBanner(specHost.dataOf(sidOf(s), "inbox"), assistantName(body.agent)) };
    // Blocks until something waits for the calling assistant in the Assistant Inbox app, or the time is up. Changes nothing.
    case "wait_for_event": {
      const ms = body.timeout_ms == null ? 25000 : Number(body.timeout_ms);
      if (!Number.isFinite(ms) || ms < 0 || ms > 25000) throw new SimError("bad_timeout", "timeout_ms must be a number from 0 to 25000");
      const me = assistantName(body.agent);
      if (!me) throw new SimError("no_caller", "the client did not give a name, so there is no inbox to wait on");
      // Ids already returned to this caller in this session do not wake it again, so a task that stays open does not make the wait spin.
      const seen = ((s.waitSeen ??= new Map()).get(me) ?? s.waitSeen.set(me, new Set()).get(me));
      const fresh = await waitForNew(() => specHost.dataOf(sidOf(s), "inbox"), me, seen, ms);
      return fresh ? { event: true, pending: fresh } : { event: false };
    }
    // Webhook wake-ups: POST a signed note to a URL when something new arrives for an assistant name. Every delivery is in device_log.
    case "register_wakeup": {
      s.wakeups ??= createWakeups(() => specHost.dataOf(sidOf(s), "inbox"), (e) => { (s.wakeLog ??= []).push({ at: Date.now(), ...e }); if (s.wakeLog.length > 200) s.wakeLog.splice(0, s.wakeLog.length - 200); });
      try { return { wakeup: await s.wakeups.register({ name: body.name, url: body.url, events: body.events, secret: body.secret, format: body.format, allowPrivate: body.allow_private === true }) }; }
      catch (e) { if (e instanceof WakeupError) throw new SimError(e.code, e.message); throw e; }
    }
    case "list_wakeups": return { wakeups: s.wakeups?.list() ?? [] };
    case "clear_wakeup": return { cleared: s.wakeups?.clear(body.name) ?? false };
    // The session's private inbox. Reads change nothing.
    case "inbox_read": return { address: s.inbox.address, messages: s.inbox.read({ subject: body.subject, from: body.from }) };
    case "inbox_wait": {
      const ms = body.timeout_ms == null ? 10000 : Number(body.timeout_ms);
      if (!Number.isFinite(ms) || ms < 0 || ms > 25000) throw new SimError("bad_timeout", "timeout_ms must be a number from 0 to 25000");
      try { return { address: s.inbox.address, message: await s.inbox.wait({ subject: body.subject, from: body.from }, ms) }; }
      catch (e) { if (e instanceof InboxError) throw new SimError(e.code, e.message); throw e; }
    }
    case "inbox_clear": return { address: s.inbox.address, cleared: s.inbox.clear() };
    case "set_network_profile": { await setNetworkProfile(s, page, body.profile); break; }
    case "get_network_profile": return { profile: s.netProfile ?? "online", screen: await screen(page) };
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
    case "device_log": return { log: [...(await page.evaluate(() => globalThis.__pnDevice?.log() ?? [])), ...s.life.log, ...s.apps.log, ...s.update.log, ...(s.netLog ?? []), ...(s.wakeLog ?? []), ...(s.browser?.navigations ?? [])], capabilities: await page.evaluate(() => globalThis.__pnDevice?.capabilities() ?? null), screen: await screen(page) };
    case "diag": {
      const r = await page.evaluate(async () => {
        const cfg = globalThis.__PN_SIM__ ?? {}; const out = { baseUrl: cfg.baseUrl, origin: location.origin };
        try { const res = await fetch(`${cfg.baseUrl}/o/${cfg.appId ?? "tide"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order: { id: "DIAG", lines: [], total: 0 } }) }); out.post = res.status; } catch (e) { out.postError = String(e); }
        try { const res = await fetch(`${cfg.baseUrl}/c/${cfg.appId}/content.json`); out.content = res.status; } catch (e) { out.contentError = String(e); }
        return out;
      });
      return { diag: r, screen: await screen(page) };
    }
    case "device_reset": s.pendingShare = null; await page.evaluate((d) => globalThis.__pnDevice?.reset(d), body.device ?? {}); await syncMedia(page); s.shade.open = "none"; break;
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
      return { sizes, skin: s.skin, screen: text };
    }
    case "back": { if (s.shade.open !== "none") { s.shade.open = "none"; break; } const b = page.getByRole("button", { name: "Back", exact: true }); if (await b.count()) { await ready(b.first()); await b.first().click(); } else throw new Error("no Back button on this screen"); break; }
    case "screenshot": {
      // format "jpeg" has no alpha channel, which the stores require. inline: true also returns the bytes as base64 for clients on another machine.
      const jpeg = body.format === "jpeg"; const p = join(DIR, `${id}-${Date.now()}.${jpeg ? "jpg" : "png"}`);
      // Home screen or switcher showing: draw it over the app for the shot, then take it away. The app stays loaded underneath.
      const away = s.nav.where !== "app";
      if (away) await page.evaluate((h) => { const d = document.createElement("div"); d.id = "__pn_away"; d.innerHTML = h; document.body.appendChild(d); }, awayScreenHtml(s.nav.where, APP_NAME) + (s.nav.where === "home" ? `<style>${storeCss}</style><div class="sf-apps" style="position:fixed;z-index:2147483647;color:#fff;font-family:system-ui,sans-serif">${installedIconsHtml(s.apps, nowOf(s))}</div>` : ""));
      let buf; try { buf = await page.screenshot(jpeg ? { path: p, type: "jpeg", quality: 90 } : { path: p }); } finally { if (away) await page.evaluate(() => document.getElementById("__pn_away")?.remove()); }
      return { path: p, ...(body.inline ? { data: buf.toString("base64") } : {}), screen: await screen(page) };
    }
    default: throw new Error(`unknown action '${body.action}'. Actions: screen, phone_apps, create_app, update_app, refresh_app, app_activity, arrange_apps, schedule_app, clear_schedule, set_time, pin_app, hide_app, export_apps, import_apps, app_action, set_app_permission, get_update_state, check_for_update, apply_update, install_app, uninstall_app, switch_app, lock, unlock, restart, press_home, open_recents, resume_app, kill_app, open_notifications, open_control_center, close_panels, toggle_tile, dismiss_notification, get_settings, set_setting, tap, locate, type, scroll, back, screenshot, set_device, push_notification, notifications, open_notification, open_url, read_share, receive_share, errors, sizes, device_log, device_reset, set_network_mocks, set_network_profile, get_network_profile, pending_banner, wait_for_event, register_wakeup, list_wakeups, clear_wakeup, inbox_read, inbox_wait, inbox_clear, browser_open, browser_snapshot, browser_click, browser_type, browser_back, browser_screenshot, browser_tabs, browser_close_tab, browser_scroll, browser_wait_for`);
  }
  return { ...(["tap", "scroll", "back"].includes(body.action) ? { delivery: "delivered" } : {}), screen: await screen(page) };
}

const DELIVERY = new Set(["tap", "type", "scroll", "back"]);
const REASONS = new Set(["stale_ref", "not_visible", "disabled", "covered"]);
const WCACHE = new Map();
const secretsForward = createSecretsForward({ control: CONTROL, token: (process.env.SHIPVO_OWNER_TOKEN || "").trim() });
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  // CORS plus Chromium's private-network preflight: the app page comes from the public control plane (https) and
  // posts orders and telemetry to this loopback backend.
  const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-private-network": "true" };
  const send = (code, obj, type = "application/json") => { res.writeHead(code, { "content-type": type, ...CORS }); res.end(type === "application/json" ? JSON.stringify(obj) : obj); };
  try {
    if (isVaultUiPath(url.pathname)) return await secretsForward(req, res, url);   // no CORS headers: same-origin loopback only
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
    // The phone frame for one session: its home screen and Store show the apps the MCP tools install, and tapping Install here installs on the session.
    if (req.method === "GET" && url.pathname === "/phone") { const id = url.searchParams.get("session") ?? ""; return send(200, phonePage(url.searchParams.get("skin") === "ios" ? "ios" : url.searchParams.get("skin") === "android" ? "android" : sessions.get(id)?.skin, id), MIME[".html"]); }
    if (req.method === "GET" && url.pathname === "/phone/apps") { const id = url.searchParams.get("session") ?? ""; if (!sessions.has(id)) return send(404, { ok: false, code: "no_session", error: "no such session" }); try { const { screen: _s, ...r } = await act(id, { action: "phone_apps" }); return send(200, { ok: true, ...r }); } catch (e) { return send(200, { ok: false, error: String(e.message).split("\n")[0], ...(e.code ? { code: e.code } : {}) }); } }
    if (req.method === "GET" && url.pathname === "/watch") { const list = watchList(sessions); const want = url.searchParams.get("skin"); return send(200, watchPage(want ?? (url.searchParams.get("session") ? sessions.get(url.searchParams.get("session"))?.skin : null) ?? list[0]?.skin, url.searchParams.get("session") ?? "", { hosted: url.searchParams.get("hosted") === "1", takeOver: url.searchParams.get("takeover") === "1", signin: url.searchParams.get("signin") ?? "" }), MIME[".html"]); }
    // Spec apps: the page for an app's current screen, and the control events the page sends back.
    { const sp = url.pathname.match(/^\/spec\/([^/]+)\/([a-z0-9-]+)\/(op)?$/);
      if (sp) {
        const [, sid, app, isOp] = sp, key = decodeURIComponent(sid);
        if (!isOp && req.method === "GET") { const html = specHost.page(key, app); return html ? send(200, html, MIME[".html"]) : send(404, { error: "no_app" }); }
        if (isOp && req.method === "POST") { let b = ""; for await (const ch of req) { b += ch; if (b.length > 65536) return send(413, { error: "too_large" }); } let j; try { j = JSON.parse(b || "{}"); } catch { return send(400, { error: "bad_json" }); } return send(200, specHost.op(key, app, j)); }
      } }
    // agent API
    if (req.method !== "POST") return send(404, { error: "not found" });
    let raw = ""; for await (const ch of req) raw += ch; const body = raw ? JSON.parse(raw) : {};
    if (url.pathname === "/apps") return send(200, { ok: true, apps: [{ id: DEFAULT_APP, name: APP_NAME }] });
    if (url.pathname === "/sessions") return send(200, { ok: true, sessions: await Promise.all([...sessions.entries()].map(async ([id, s]) => ({ session: id, app: s.app, release: s.release, started_at: s.startedAt ?? null, skin: s.skin, streaming: isWatched(s) || !!s.browser?.screencast, url: s.page.url(), room: s.room ?? null, title: await s.page.title().catch(() => "") }))) });
    if (url.pathname === "/room_log" || url.pathname === "/room_note") {
      const room = String(body.room ?? "");
      if (!rooms.has(room)) return send(200, { ok: false, code: "no_room", error: `no open room "${room}"` });
      if (url.pathname === "/room_note") {
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) return send(200, { ok: false, code: "bad_note", error: "note text is empty" });
        if (text.length > NOTE_MAX) return send(200, { ok: false, code: "note_too_long", error: `note is ${text.length} characters; the limit is ${NOTE_MAX}` });
        roomLog(room, { kind: "note", session: null, agent: typeof body.agent === "string" ? body.agent.slice(0, 64) : null, text });
        return send(200, { ok: true, cursor: String(roomLogs.get(room).n) });
      }
      const l = roomLogs.get(room) ?? { n: 0, entries: [] };
      const since = body.since == null ? 0 : Number(body.since);
      if (!Number.isInteger(since) || since < 0) return send(200, { ok: false, code: "bad_cursor", error: "since must be a cursor from an earlier room_log" });
      return send(200, { ok: true, entries: l.entries.filter((e) => e.n > since), cursor: String(l.n) });
    }
    if (url.pathname === "/end") return send(200, { ok: true, ended: await endSession(String(body.session)) });
    if (url.pathname === "/session") { try { await newSession(body.session, body); } catch (e) { if (e instanceof BuildCacheError || (e instanceof SimError && (e.code === "bad_profile" || e.code === "bad_room" || e.code === "bad_app"))) return send(200, { ok: false, code: e.code, error: e.message }); throw e; } const s = sessions.get(body.session); log(body.session, "start", true, { app: s.app, release: s.release }); return send(200, { ok: true, app: s.app, release: s.release, ...(s.build ? { build: s.build } : {}), screen: await screen(s.page) }); }
    if (url.pathname === "/act") {
      try { const s0 = sessions.get(body.session); const prevScreen = s0?.lastScreen; const r = await act(body.session, body);
        if (s0 && typeof r.screen === "string") { s0.lastScreen = r.screen; watch.step(body.session, describeStep(body, prevScreen), changeLine(prevScreen, r.screen)); }
        if (s0?.room && describeStep(body, prevScreen)) roomLog(s0.room, { kind: "action", session: body.session, agent: typeof body.agent === "string" ? body.agent.slice(0, 64) : null, tool: String(body.action), target: body.ref ? String(body.ref) : null, change: changeLine(prevScreen, r.screen) || null });
        if (body.action !== "pending_banner") log(body.session, body.action, true, body.ref ? { ref: body.ref } : {}); return send(200, { ok: true, ...r }); }
      catch (e) { log(body.session, body.action, false); const s = sessions.get(body.session); return send(200, { ok: false, error: e.code === "invalid_spec" ? String(e.message) : String(e.message).split("\n")[0], ...(e.code ? { code: e.code } : {}), ...(DELIVERY.has(body.action) && REASONS.has(e.code) ? { delivery: "not_delivered", reason: e.code, safe_to_retry: true } : {}), screen: s ? await screen(s.page) : null }); }
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
