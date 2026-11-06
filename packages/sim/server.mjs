#!/usr/bin/env node
// Shipvo UI simulator: runs the real app UI (React Native Web build) in a phone-sized headless browser,
// and lets an agent see the screen as an accessibility tree and act on it: tap, type, scroll, back.
// No emulator, no device. Each session also gets a mock control plane that records orders for grading.
//   shipvo sim  (or: node packages/sim/server.mjs) [--port 4545] [--dir /tmp/pn-ui] [--dist ./sim-dist] [--app <id>]
// Reads shipvo.json in the current directory (appId, name, controlPlane) when present.
import http from "node:http";
import { readFileSync, existsSync, writeFileSync, appendFileSync, mkdirSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withAppName } from "./app-name.mjs";
import { parseMockRules } from "./mock-rules.mjs";
import { pushNotification } from "./push-notification.mjs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { resolveBrowser } from "./browser-resolver.mjs";
import { PhoneBrowser } from "./phone-browser.mjs";
import { acceptWebSocket } from "./ws-lite.mjs";
import { browserAppPage } from "./browser-app.mjs";
import { launchErrorMessage } from "./chromium-hint.mjs";
import { shadeAction, SHADE_ACTIONS } from "./shade-actions.mjs";
import { settingsAction, syncMedia, SETTINGS_ACTIONS } from "./settings-actions.mjs";
import { SettingsError } from "./settings.mjs";
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

async function newSession(id, opts = {}) {
  if (sessions.has(id)) { const old = sessions.get(id); for (const p of old.peers ?? []) p.close(); await (await old.browserP?.catch(() => undefined))?.close(); await old.ctx.close(); }
  const target = await resolveApp(opts.app);
  writeFileSync(join(DIR, `${id}.json`), JSON.stringify({ orders: [] })); writeFileSync(join(DIR, `${id}.json.log`), "");
  const browser = await browserReady;
  // Optional width, height (output pixels) and scale (device pixel ratio) make a session render at a store screenshot size.
  const size = Number.isInteger(opts.width) && Number.isInteger(opts.height) && opts.width > 0 && opts.height > 0 ? { viewport: { width: Math.round(opts.width / (opts.scale || 1)), height: Math.round(opts.height / (opts.scale || 1)) }, deviceScaleFactor: opts.scale || 1 } : {};
  const ctx = await browser.newContext({ ...phone, ...size, colorScheme: opts.dark ? "dark" : "light" });
  // The app's Linking.openURL for a web page lands here (see @shipvo/device): it opens in the Browser app, not in the app.
  await ctx.exposeFunction("__pnOpenBrowser", (url) => openInBrowserApp(id, String(url)));
  await ctx.addInitScript((cfg) => { globalThis.__PN_SIM__ = cfg; }, { baseUrl: `http://localhost:${PORT}/s/${id}`, appId: target.app, appName: APP_NAME, seed_cart: opts.seed_cart ?? null, device: opts.device ?? null });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e?.message ?? e).split("\n")[0]));
  await page.goto(target.url, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  sessions.set(id, { ctx, page, errors, app: target.app, release: target.release, startedAt: new Date().toISOString(), life: createLifecycle(), shade: { open: "none" }, nav: createNav() });
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
  if (["tap", "type", "scroll", "back", "open_url", "open_notification", ...SHADE_ACTIONS, ...SETTINGS_ACTIONS].includes(body.action)) { try { assertUnlocked(s.life); } catch (e) { throw new SimError(e.code, e.message); } }
  // Home screen or app switcher showing: the app is in the background and takes no input.
  if (["tap", "type", "scroll", "back", "open_url", "open_notification", "open_notifications", "open_control_center", "toggle_tile", "dismiss_notification"].includes(body.action)) { try { assertForeground(s.nav); } catch (e) { throw new SimError(e.code, e.message); } }
  // An open panel covers the app on a phone, so input to the app is refused until it is closed.
  if (["tap", "type", "scroll"].includes(body.action) && s.shade.open !== "none") throw new SimError("panel_open", `a panel (${s.shade.open}) is open and covers the app, so nothing was sent to it. Close it first (close_panels).`);
  switch (body.action) {
    // Home, recents, resume and kill. The app hears them as AppState changes (document.visibilityState). Kill is a cold start.
    case "press_home": case "open_recents": case "resume_app": case "kill_app": {
      let ev;
      try { ev = body.action === "press_home" ? pressHome(s.nav) : body.action === "open_recents" ? openRecents(s.nav) : body.action === "resume_app" ? resume(s.nav) : (killApp(s.nav), null); }
      catch (e) { if (e instanceof NavError) throw new SimError(e.code, e.message); throw e; }
      if (ev) await page.evaluate(setVisibilityInPage, ev);
      if (body.action === "kill_app") { s.life.reloads++; await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(300); await page.evaluate(setVisibilityInPage, "background"); }
      const where = s.nav.where;
      return { where, appState: where === "app" ? "active" : "background", reloads: s.life.reloads, screen: where === "app" ? await screen(page) : where === "home" ? `Home screen\n- button "${APP_NAME}" (the app icon: resume_app opens it)` : `App switcher\n- card "${APP_NAME}" (resume_app opens it, kill_app closes it)` };
    }
    // Simulated lock, unlock and restart. Restart reloads the page (a cold start of the app); the browser context keeps storage.
    case "lock": case "unlock": {
      if (body.action === "lock") s.shade.open = "none";
      try { (body.action === "lock" ? lock : unlock)(s.life); } catch (e) { if (e instanceof LifecycleError) throw new SimError(e.code, e.message); throw e; }
      return { locked: s.life.locked, screen: s.life.locked ? "Lock screen" : await screen(page) };
    }
    case "restart": {
      restart(s.life); s.shade.open = "none"; s.nav.where = "app";
      await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(300);
      return { reloads: s.life.reloads, restarts: s.life.restarts, screen: await screen(page) };
    }
    case "screen": break;
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
      const handled = await page.evaluate((u) => globalThis.__pnDevice?.openUrl(u), body.url);
      if (!handled) throw new SimError("no_url_listener", `the app has no URL listener, so it did not handle ${body.url}. Register one with onUrl from @shipvo/device.`);
      await page.waitForTimeout(400); break;
    }
    // Stub fetch/XHR on the page. Rules live on the session; unmatched requests continue untouched.
    case "set_network_mocks": {
      let rules; try { rules = parseMockRules(body.rules ?? []); } catch (e) { throw new SimError(e.code ?? "mock_invalid", e.message); }
      s.mocks = rules;
      if (!s.mockRoute) {
        s.mockRoute = true;
        await page.route("**/*", async (route) => {
          const req = route.request();
          const type = req.resourceType();
          const rule = (type === "fetch" || type === "xhr") && (s.mocks ?? []).find((m) => (!m.method || m.method === req.method()) && m.match(req.url()));
          if (!rule) return route.fallback();
          if (rule.delayMs) await new Promise((r) => setTimeout(r, rule.delayMs));
          // The app page may come from another origin, so the stub must pass the browser's CORS check.
          await route.fulfill({ status: rule.status, body: rule.body, headers: { "access-control-allow-origin": "*", ...rule.headers } }).catch(() => {});
        });
      }
      break;
    }
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
    case "device_log": return { log: [...(await page.evaluate(() => globalThis.__pnDevice?.log() ?? [])), ...s.life.log, ...(s.browser?.navigations ?? [])], capabilities: await page.evaluate(() => globalThis.__pnDevice?.capabilities() ?? null), screen: await screen(page) };
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
    default: throw new Error(`unknown action '${body.action}'. Actions: screen, lock, unlock, restart, press_home, open_recents, resume_app, kill_app, open_notifications, open_control_center, close_panels, toggle_tile, dismiss_notification, get_settings, set_setting, tap, locate, type, scroll, back, screenshot, set_device, push_notification, notifications, open_notification, open_url, errors, sizes, device_log, device_reset, set_network_mocks, browser_open, browser_snapshot, browser_click, browser_type, browser_back, browser_screenshot, browser_tabs, browser_close_tab, browser_scroll, browser_wait_for`);
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
    // a founder opening the printed link lands on the app
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/") { res.writeHead(302, { location: "/app/", ...CORS }); return res.end(); }
    if (url.pathname.startsWith("/app/")) {
      let p = join(DIST, url.pathname.slice(5) || "index.html"); if (!existsSync(p) || statSync(p).isDirectory()) p = join(DIST, "index.html");
      if (extname(p) === ".html") return send(200, withAppName(readFileSync(p, "utf8"), APP_NAME), MIME[".html"]);
      return send(200, readFileSync(p), MIME[extname(p)] ?? "application/octet-stream");
    }
    // mock control plane per session
    const m = url.pathname.match(/^\/s\/([\w-]+)\/(.*)$/);
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
    // agent API
    if (req.method !== "POST") return send(404, { error: "not found" });
    let raw = ""; for await (const ch of req) raw += ch; const body = raw ? JSON.parse(raw) : {};
    if (url.pathname === "/apps") return send(200, { ok: true, apps: [{ id: DEFAULT_APP, name: APP_NAME }] });
    if (url.pathname === "/sessions") return send(200, { ok: true, sessions: [...sessions.entries()].map(([id, s]) => ({ session: id, app: s.app, release: s.release, started_at: s.startedAt ?? null, url: s.page.url() })) });
    if (url.pathname === "/session") { await newSession(body.session, body); const s = sessions.get(body.session); log(body.session, "start", true, { app: s.app, release: s.release }); return send(200, { ok: true, app: s.app, release: s.release, screen: await screen(s.page) }); }
    if (url.pathname === "/act") {
      try { const r = await act(body.session, body); log(body.session, body.action, true, body.ref ? { ref: body.ref } : {}); return send(200, { ok: true, ...r }); }
      catch (e) { log(body.session, body.action, false); const s = sessions.get(body.session); return send(200, { ok: false, error: String(e.message).split("\n")[0], ...(e.code ? { code: e.code } : {}), ...(DELIVERY.has(body.action) && REASONS.has(e.code) ? { delivery: "not_delivered", reason: e.code, safe_to_retry: true } : {}), screen: s ? await screen(s.page) : null }); }
    }
    send(404, { error: "not found" });
  } catch (e) { send(500, { error: String(e) }); }
});
// The Browser app's live view: frames out, taps, swipes and typing in. Same trust as the HTTP API (loopback), plus an Origin check
// so another web page open on this machine cannot drive the phone.
server.on("upgrade", (req, socket) => {
  const url = new URL(req.url, "http://x");
  const refuse = (line) => socket.end(`HTTP/1.1 ${line}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  if (url.pathname !== "/browser/ws") return refuse("404 Not Found");
  let originHost = null; try { if (req.headers.origin) originHost = new URL(req.headers.origin).host; } catch { originHost = "invalid"; }
  // A missing Origin is allowed (non-browser clients). The Host comparison does not stop DNS rebinding, since both
  // values come from the requester; the HTTP API has the same trust level.
  if (originHost && originHost !== req.headers.host) return refuse("403 Forbidden");
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
