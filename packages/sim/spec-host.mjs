// Runs app specs on the simulated phone. A spec app is a JSON document (see @shipvo/spec). This host keeps one running
// app per phone and app id, renders its screen as a page the phone shows, and applies the taps, typing and choices
// that page sends back. The page is real HTML with labelled controls, so the screen and tap tools work on it as on any app.
import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createApp, runSource, memoryCache } from "@shipvo/spec";

const REFRESH_POLL_MS = 5000;
const FETCH_TIMEOUT_MS = 15000;

/** True for loopback, private, link-local, unspecified and other non-public addresses (IPv4 and IPv6). */
export function isPrivateAddress(ip) {
  const v = ip.toLowerCase();
  const m4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (m4) return isPrivateAddress(m4[1]);
  const mh = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v); // the form URL parsing produces
  if (mh) { const n = (parseInt(mh[1], 16) << 16) | parseInt(mh[2], 16); return isPrivateAddress([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".")); }
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (isIP(v) === 6) return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff");
  return true;
}

/**
 * The fetch a refresh uses by default: public http(s) hosts only (every resolved address is checked), no redirects
 * followed, and a timeout so one hung request cannot stop later refreshes. `lookup` can be replaced in tests.
 */
export function guardedFetch({ lookup = (h) => dnsLookup(h, { all: true }), fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  return async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http and https URLs can be fetched");
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) throw new Error(`Refused: ${host} is not a public host`);
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host);
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error(`Refused: ${host} is not a public host`);
    return fetchImpl(u, { ...init, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  };
}

/** The script the page runs. Controls are found by their role and accessible name, as an agent finds them. */
export const HOST_SCRIPT = `(function(){
var base=location.pathname.replace(/\\/$/,"");
function send(op){return fetch(base+"/op",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(op)}).then(function(r){return r.json()}).then(function(r){
 if(r&&typeof r.html==="string"){shown=r.v;swap(r.html)}
 if(r&&r.ok===false){var p=document.createElement("p");p.setAttribute("role","alert");p.textContent=r.error||"That did not work";document.body.insertBefore(p,document.body.firstChild)}})}
function name(el){return el.getAttribute("aria-label")||el.textContent.trim()}
function form(el){var f=el.closest("form");return f?f.getAttribute("aria-label"):null}
var hs=document.getElementById("sv-host");var shown=hs?hs.getAttribute("data-v"):null;
function swap(h){var m=/<body[^>]*>([\\s\\S]*)<\\/body>/i.exec(h);if(!m)return;var y=window.scrollY,s=document.getElementById("sv-host");document.body.innerHTML=m[1];if(s)document.body.appendChild(s);window.scrollTo(0,y)}
function poll(){if(document.hidden)return;fetch(base+"/op",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({op:"view"})}).then(function(r){return r.json()}).then(function(r){
 if(!r||typeof r.html!=="string"||r.v===shown)return;
 var ae=document.activeElement;if(ae&&/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))return;
 shown=r.v;swap(r.html)}).catch(function(){})}
if(${REFRESH_POLL_MS})setInterval(poll,${REFRESH_POLL_MS});
document.addEventListener("click",function(e){var t=e.target;if(!t.closest)return;
 var sw=t.closest('button[role="switch"]');if(sw)return send({op:"toggle",label:name(sw)});
 var rd=t.closest('button[role="radio"]');if(rd){var g=rd.parentElement&&rd.parentElement.parentElement;return send({op:"select",label:g?g.getAttribute("aria-label"):"",option:rd.textContent.trim()})}
 var tab=t.closest('[role="tab"]');if(tab)return send({op:"tab",label:name(tab)});
 var b=t.closest("button");if(b&&!b.closest('[role="switch"]')){var fm=form(b);return fm?send({op:"submit",form:fm}):send({op:"press",label:name(b)})}});
document.addEventListener("change",function(e){var t=e.target;if(!t||!t.closest)return;var fm=form(t);if(!fm)return;
 if(t.type==="radio"){var g=t.closest('[role="radiogroup"]');return send({op:"field",form:fm,field:g?g.getAttribute("aria-label"):"",value:name(t)})}
 send({op:"field",form:fm,field:name(t),value:t.type==="checkbox"?t.checked:t.value})});
})();`;

const version = (html) => createHash("sha1").update(html).digest("hex").slice(0, 16);
const withScript = (html) => html.replace("</body>", `<script id="sv-host" data-v="${version(html)}">${HOST_SCRIPT}</script></body>`);

const key = (session, id) => `${session}/${id}`;

/** The page shows a field by its label; the app stores it by its name. Finds the name in the spec. */
function fieldName(spec, form, shown) {
  let found;
  const walk = (n) => {
    if (found || !n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.type === "form" && (n.id === form || n.label === form) && Array.isArray(n.fields)) {
      const f = n.fields.find((x) => (x.label ?? x.name) === shown || x.name === shown);
      if (f) found = f.name;
    }
    Object.values(n).forEach(walk);
  };
  walk(spec.screens);
  return found ?? shown;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Plain lines that say what changed between two specs: screens, actions, data and settings added, removed or changed. */
export function diffSpec(a, b) {
  const out = [];
  const parts = [
    ["screen", Object.fromEntries((a?.screens ?? []).map((x) => [x.id, x])), Object.fromEntries((b?.screens ?? []).map((x) => [x.id, x]))],
    ["action", a?.actions ?? {}, b?.actions ?? {}],
    ["data", a?.data ?? {}, b?.data ?? {}],
    ["state", a?.state ?? {}, b?.state ?? {}],
  ];
  for (const [kind, x, y] of parts) {
    for (const k of Object.keys(y)) if (!(k in x)) out.push(`added ${kind} '${k}'`);
    for (const k of Object.keys(x)) if (!(k in y)) out.push(`removed ${kind} '${k}'`);
    for (const k of Object.keys(y)) if (k in x && !same(x[k], y[k])) out.push(`changed ${kind} '${k}'`);
  }
  if (!same(a?.app, b?.app)) out.push("changed app details");
  if (!same(a?.permissions, b?.permissions)) out.push("changed permissions");
  return out;
}

/** What a spec has, in one line: used for the first entry in an app's history. */
export function describeSpec(spec) {
  const n = (v) => Array.isArray(v) ? v.length : Object.keys(v ?? {}).length;
  return `${n(spec?.screens)} screens, ${n(spec?.actions)} actions, ${n(spec?.data)} data sources`;
}

export class SpecHost {
  /**
   * `timers` is { setInterval, clearInterval } and `context(session, id)` returns the runner context for an app
   * (fetch, secrets, limits). Both can be replaced in tests; the defaults use the real clock and network.
   */
  constructor({ timers = { setInterval, clearInterval }, context } = {}) {
    this.running = new Map();
    this.timers = timers;
    this.cache = memoryCache();
    this.guarded = guardedFetch();
    this.context = context ?? (() => ({ fetch: this.guarded, secrets: () => ({ refused: "unavailable" }), cache: this.cache }));
    this.refreshing = new Map();
    this.networks = new Map();
  }

  /** The phone's network for a session, shared by every app on it. Apps read it as `network`; http sources do not fetch while it is offline. */
  network(session) {
    if (!this.networks.has(session)) this.networks.set(session, { online: true, type: "wifi" });
    return this.networks.get(session);
  }
  /** Changes the session's network in place, so every running app sees it on its next render. */
  setNetwork(session, { online, type }) { Object.assign(this.network(session), { online: online !== false, type: online === false ? "none" : type ?? "wifi" }); return { ...this.network(session) }; }

  /** Re-runs each http data source that sets `refresh` (seconds) on that interval, until the app is dropped or replaced. */
  schedule(session, id) {
    const k = key(session, id);
    this.unschedule(k);
    const r = this.running.get(k);
    const handles = [];
    for (const [name, src] of Object.entries(r?.spec?.data ?? {})) {
      if (src?.source !== "http" || typeof src.refresh !== "number" || !(src.refresh >= 30)) continue; // the validator reports other values; skip them here
      let busy = false;
      const h = this.timers.setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
          const cur = this.running.get(k);
          if (!cur || cur !== r) return;
          if (!this.network(session).online) return; // offline: keep the last value and try again on the next tick
          // Refresh runs bypass the cache: a `cache` longer than `refresh` must not turn the refresh into a no-op.
          const { cache: _cache, ...ctx } = this.context(session, id);
          const value = await runSource(cur.spec, name, { ...ctx, scope: { state: cur.app.state, data: cur.app.data, ...cur.app.data } });
          // The app may have been removed or replaced while the request ran.
          if (this.running.get(k) === cur) cur.app.data[name] = value;
        } catch { /* a failed refresh keeps the last value and tries again on the next tick */ }
        finally { busy = false; }
      }, src.refresh * 1000);
      h?.unref?.();
      handles.push(h);
    }
    if (handles.length) this.refreshing.set(k, handles);
  }

  /** Runs the app's http data sources now (all, or the ones named), ignoring the cache. Resolves { updated, errors }; a failed source keeps its last data. */
  async refresh(session, id, { sources } = {}) {
    const k = key(session, id);
    const cur = this.running.get(k);
    const out = { updated: [], errors: [] };
    if (!cur) return out;
    const names = Object.entries(cur.spec?.data ?? {}).filter(([n, s]) => s?.source === "http" && (!sources || sources.includes(n))).map(([n]) => n);
    if (!this.network(session).online) { for (const name of names) out.errors.push({ source: name, message: "offline: the phone has no network (Wi-Fi and mobile data are off, or airplane mode is on)" }); return out; }
    for (const name of names) {
      try {
        const { cache: _cache, ...ctx } = this.context(session, id);
        const value = await runSource(cur.spec, name, { ...ctx, scope: { state: cur.app.state, data: cur.app.data, ...cur.app.data } });
        if (this.running.get(k) !== cur) break; // the app was removed or replaced while the request ran
        if (JSON.stringify(cur.app.data[name]) !== JSON.stringify(value)) { cur.app.data[name] = value; out.updated.push(name); }
      } catch (e) { out.errors.push({ source: name, message: String(e?.message ?? e).slice(0, 200) }); }
    }
    return out;
  }

  unschedule(k) {
    for (const h of this.refreshing.get(k) ?? []) this.timers.clearInterval(h);
    this.refreshing.delete(k);
  }

  /** Starts an app from a spec. Resolves { ok: true } or { ok: false, errors } with a JSON path and a fix for each problem. */
  create(session, id, spec, { style = "android", reduceMotion = false, data, state, permissions = {} } = {}) {
    const devicePermissions = { ...permissions };   // shared with the running app: setPermissions changes it in place
    const made = createApp(spec, { style, reduceMotion, devicePermissions, network: this.network(session), ...(data ? { data } : {}), ...(state ? { state } : {}) });
    if (!made.ok) return { ok: false, errors: made.errors };
    this.running.set(key(session, id), { app: made.app, spec, style, reduceMotion, devicePermissions, version: 1, history: [{ version: 1, at: Date.now(), changes: [`created: ${describeSpec(spec)}`] }] });
    this.schedule(session, id);
    return { ok: true, warnings: made.app.render().warnings ?? [] };
  }

  /**
   * Replaces an app's spec with a new version. What the person entered stays: collection data and state values that
   * the new spec still has carry over. A spec with problems is refused with its errors and the running version is untouched.
   * Resolves { ok: true, version, from } or { ok: false, errors }.
   */
  update(session, id, spec) {
    const cur = this.running.get(key(session, id));
    if (!cur) return { ok: false, errors: [{ path: "$", message: "That app is not running", fix: "Create it with create_app" }] };
    const keep = (names, from) => Object.fromEntries(Object.entries(from).filter(([k]) => names.includes(k)));
    const collections = Object.entries(spec?.data ?? {}).filter(([, v]) => v?.source === "collection").map(([k]) => k);
    const stateKeys = Object.keys(spec?.state ?? {});
    const made = createApp(spec, { style: cur.style, reduceMotion: cur.reduceMotion, devicePermissions: cur.devicePermissions, network: this.network(session), data: keep(collections, cur.app.data), state: keep(stateKeys, cur.app.state) });
    if (!made.ok) return { ok: false, errors: made.errors };
    const from = cur.version;
    this.running.set(key(session, id), { ...cur, app: made.app, spec, version: from + 1, history: [...cur.history, { version: from + 1, at: Date.now(), changes: diffSpec(cur.spec, spec) }] });
    this.schedule(session, id);
    return { ok: true, version: from + 1, from, warnings: made.app.render().warnings ?? [] };
  }

  /** Checks a spec without starting it. Resolves { ok: true } or { ok: false, errors }. */
  check(spec, style = "android") {
    const made = createApp(spec, { style });
    return made.ok ? { ok: true } : { ok: false, errors: made.errors };
  }

  /** What a person entered in an app: its spec, style, collection data and settings (state). Nothing from the vault is held here. */
  snapshot(session, id) {
    const r = this.running.get(key(session, id));
    if (!r) return null;
    const names = Object.entries(r.spec?.data ?? {}).filter(([, v]) => v?.source === "collection").map(([k]) => k);
    return { style: r.style, spec: structuredClone(r.spec), data: structuredClone(Object.fromEntries(names.filter((n) => n in r.app.data).map((n) => [n, r.app.data[n]]))), settings: structuredClone(r.app.state) };
  }

  /** Sets one permission answer for a running app. The next action sees it. */
  // An unknown app is ignored on purpose: the person may toggle Settings for an app that is not running yet.
  setPermission(session, id, permission, allowed) { const r = this.running.get(key(session, id)); if (r) r.devicePermissions[permission] = allowed; }

  /** Makes a running app's permission answers exactly `answers` (after an update that declares other permissions). */
  syncPermissions(session, id, answers) { const r = this.running.get(key(session, id)); if (!r) return; for (const k of Object.keys(r.devicePermissions)) delete r.devicePermissions[k]; Object.assign(r.devicePermissions, answers); }

  /** Every version of an app with what changed in it, newest last. */
  history(session, id) { return (this.running.get(key(session, id))?.history ?? []).map((h) => ({ version: h.version, at: h.at, changes: h.changes ?? [] })); }

  /** The app's http data sources and how often each refreshes (seconds, or null when only refresh_app fetches it). */
  sources(session, id) {
    const r = this.running.get(key(session, id));
    return Object.entries(r?.spec?.data ?? {}).filter(([, s]) => s?.source === "http").map(([name, s]) => ({ name, refresh: typeof s.refresh === "number" ? s.refresh : null }));
  }

  version(session, id) { return this.running.get(key(session, id))?.version ?? null; }

  has(session, id) { return this.running.has(key(session, id)); }
  /** The app's current data, or undefined when it is not running. */
  dataOf(session, id) { return this.running.get(key(session, id))?.app.data; }
  drop(session, id) { this.unschedule(key(session, id)); return this.running.delete(key(session, id)); }
  dropSession(session) { for (const k of [...this.running.keys()]) if (k.startsWith(`${session}/`)) { this.unschedule(k); this.running.delete(k); } this.networks.delete(session); }

  /** The page for an app's current screen. */
  page(session, id) {
    const r = this.running.get(key(session, id));
    if (!r) return null;
    const out = r.app.render();
    if (!out.ok) return null;
    return withScript(out.html);
  }

  /** The screen as text for an agent: role and name of each node. */
  tree(session, id) {
    const r = this.running.get(key(session, id));
    const out = r?.app.render();
    return out?.ok ? out.tree : null;
  }

  /** Runs an action by name with the given input, as a generated tool does. Resolves { ok, value } or { ok: false, error }. */
  call(session, id, action, input = {}, context = {}) {
    const r = this.running.get(key(session, id));
    if (!r) return { ok: false, error: "That app is not running" };
    const res = r.app.call(action, input, context);
    return res.ok === false && "errors" in res ? { ok: false, error: Object.values(res.errors).join(" ") } : res;
  }

  /** Applies one control event from the page. Resolves { ok, html } or { ok: false, error, html }. */
  op(session, id, body) {
    const r = this.running.get(key(session, id));
    if (!r) return { ok: false, error: "That app is not running" };
    const a = r.app;
    let res;
    switch (body?.op) {
      case "press": res = a.press(String(body.label ?? "")); break;
      case "toggle": res = a.toggle(String(body.label ?? "")); break;
      case "select": res = a.select(String(body.label ?? ""), String(body.option ?? "")); break;
      case "tab": res = a.selectTab(String(body.label ?? "")); break;
      case "field": try { a.setField(String(body.form ?? ""), fieldName(r.spec, String(body.form ?? ""), String(body.field ?? "")), body.value); res = { ok: true }; } catch (e) { res = { ok: false, error: String(e?.message ?? e) }; } break;
      case "submit": res = a.submit(String(body.form ?? "")); break;
      case "view": res = { ok: true }; break; // no change: returns the current page so refreshed data reaches an open screen
      default: res = { ok: false, error: `unknown op '${body?.op}'` };
    }
    const out = a.render();
    const html = out.ok ? withScript(out.html) : undefined;
    return { ...(res.ok === false && "errors" in res ? { ok: false, error: Object.values(res.errors).join(" ") } : res), ...(html ? { html, v: version(out.html) } : {}) };
  }
}
