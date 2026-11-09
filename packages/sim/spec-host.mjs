// Runs app specs on the simulated phone. A spec app is a JSON document (see @shipvo/spec). This host keeps one running
// app per phone and app id, renders its screen as a page the phone shows, and applies the taps, typing and choices
// that page sends back. The page is real HTML with labelled controls, so the screen and tap tools work on it as on any app.
import { createApp, runSource, RunError } from "@shipvo/spec";

/** The script the page runs. Controls are found by their role and accessible name, as an agent finds them. */
export const HOST_SCRIPT = `(function(){
var base=location.pathname.replace(/\\/$/,"");
function send(op){return fetch(base+"/op",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(op)}).then(function(r){return r.json()}).then(function(r){
 if(r&&typeof r.html==="string"){var m=/<body[^>]*>([\\s\\S]*)<\\/body>/i.exec(r.html);if(m){var s=document.getElementById("sv-host");document.body.innerHTML=m[1];if(s)document.body.appendChild(s)}}
 if(r&&r.ok===false){var p=document.createElement("p");p.setAttribute("role","alert");p.textContent=r.error||"That did not work";document.body.insertBefore(p,document.body.firstChild)}})}
function name(el){return el.getAttribute("aria-label")||el.textContent.trim()}
function form(el){var f=el.closest("form");return f?f.getAttribute("aria-label"):null}
document.addEventListener("click",function(e){var t=e.target;if(!t.closest)return;
 var sw=t.closest('button[role="switch"]');if(sw)return send({op:"toggle",label:name(sw)});
 var rd=t.closest('button[role="radio"]');if(rd){var g=rd.parentElement&&rd.parentElement.parentElement;return send({op:"select",label:g?g.getAttribute("aria-label"):"",option:rd.textContent.trim()})}
 var tab=t.closest('[role="tab"]');if(tab)return send({op:"tab",label:name(tab)});
 var b=t.closest("button");if(b&&!b.closest('[role="switch"]')){var fm=form(b);return fm?send({op:"submit",form:fm}):send({op:"press",label:name(b)})}});
document.addEventListener("change",function(e){var t=e.target;if(!t||!t.closest)return;var fm=form(t);if(!fm)return;
 if(t.type==="radio"){var g=t.closest('[role="radiogroup"]');return send({op:"field",form:fm,field:g?g.getAttribute("aria-label"):"",value:name(t)})}
 send({op:"field",form:fm,field:name(t),value:t.type==="checkbox"?t.checked:t.value})});
})();`;

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

const UNIT = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 };
/** How often a live data source is fetched again: its `cache` time in the spec, else every 5 minutes. */
export function refreshEvery(source) {
  const m = /^(\d+)(s|m|h|d)$/.exec(String(source?.cache ?? ""));
  return m ? Number(m[1]) * UNIT[m[2]] : 5 * 6e4;
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
   * @param opts.fetch  how live data is fetched (default: the global fetch). Same shape as RunContext.fetch.
   * @param opts.now    clock in ms, for tests.
   * @param opts.onChange  called with (session, id, out) after a background refresh fetched or failed.
   */
  constructor(opts = {}) {
    this.running = new Map();
    this.fetch = opts.fetch ?? ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }));
    this.now = opts.now ?? Date.now;
    this.onChange = opts.onChange;
  }

  /**
   * Fetches the app's live data sources (the spec's `http` sources) that are due, or all of them with `force`.
   * Data that comes back replaces the source's data in the running app; a source that fails keeps its last good data.
   * Resolves { fetched: [names fetched], updated: [names whose data changed], errors: [{ source, code, message }] }.
   */
  async refresh(session, id, { force = false } = {}) {
    const r = this.running.get(key(session, id));
    if (!r) return { fetched: [], updated: [], errors: [{ source: "", code: "not_running", message: "That app is not running" }] };
    const fetched = [], updated = [], errors = [];
    for (const [name, src] of Object.entries(r.spec.data ?? {})) {
      if (src?.source !== "http") continue;
      const info = (r.sources[name] ??= { at: 0 });
      if (!force && info.at && this.now() - info.at < refreshEvery(src)) continue;
      info.at = this.now();
      try {
        const before = JSON.stringify(r.app.data[name] ?? null);
        r.app.data[name] = await runSource(r.spec, name, { fetch: this.fetch, secrets: () => ({ refused: "unavailable" }), scope: { state: r.app.state, data: r.app.data } });
        info.ok = true; delete info.error; fetched.push(name);
        if (JSON.stringify(r.app.data[name] ?? null) !== before) updated.push(name);
      } catch (e) {
        const code = e instanceof RunError ? e.code : "fetch_failed";
        info.ok = false; info.error = { code, message: String(e?.message ?? e).split("\n")[0] };
        errors.push({ source: name, ...info.error });
      }
    }
    return { fetched, updated, errors };
  }

  /** Checks every running app for due data. Call it on a timer. Tells `onChange` about apps that fetched or failed to fetch, so each is logged. */
  async tick() {
    // Apps are refreshed side by side, so one slow host does not hold up the others.
    await Promise.all([...this.running.keys()].map(async (k) => {
      const [session, id] = [k.slice(0, k.lastIndexOf("/")), k.slice(k.lastIndexOf("/") + 1)];
      const out = await this.refresh(session, id);
      if (out.fetched.length || out.errors.length) this.onChange?.(session, id, out);
    }));
  }

  /** What each live source last did, for the person or agent to see. */
  sources(session, id) {
    const r = this.running.get(key(session, id));
    return r ? Object.entries(r.sources).map(([name, i]) => ({ name, every_ms: refreshEvery(r.spec.data[name]), last_at: i.at || null, ok: i.ok ?? null, ...(i.error ? { error: i.error } : {}) })) : [];
  }

  /** Starts an app from a spec. Resolves { ok: true } or { ok: false, errors } with a JSON path and a fix for each problem. */
  async create(session, id, spec, { style = "android", reduceMotion = false } = {}) {
    const made = createApp(spec, { style, reduceMotion });
    if (!made.ok) return { ok: false, errors: made.errors };
    this.running.set(key(session, id), { app: made.app, spec, style, reduceMotion, version: 1, history: [{ version: 1, at: Date.now(), changes: [`created: ${describeSpec(spec)}`] }], sources: {} });
    const live = await this.refresh(session, id, { force: true });
    return { ok: true, warnings: made.app.render().warnings ?? [], data_errors: live.errors };
  }

  /**
   * Replaces an app's spec with a new version. What the person entered stays: collection data and state values that
   * the new spec still has carry over. A spec with problems is refused with its errors and the running version is untouched.
   * Resolves { ok: true, version, from } or { ok: false, errors }.
   */
  async update(session, id, spec) {
    const cur = this.running.get(key(session, id));
    if (!cur) return { ok: false, errors: [{ path: "$", message: "That app is not running", fix: "Create it with create_app" }] };
    const keep = (names, from) => Object.fromEntries(Object.entries(from).filter(([k]) => names.includes(k)));
    const collections = Object.entries(spec?.data ?? {}).filter(([, v]) => v?.source === "collection").map(([k]) => k);
    const stateKeys = Object.keys(spec?.state ?? {});
    const made = createApp(spec, { style: cur.style, reduceMotion: cur.reduceMotion, data: keep(collections, cur.app.data), state: keep(stateKeys, cur.app.state) });
    if (!made.ok) return { ok: false, errors: made.errors };
    const from = cur.version;
    this.running.set(key(session, id), { ...cur, app: made.app, spec, version: from + 1, history: [...cur.history, { version: from + 1, at: Date.now(), changes: diffSpec(cur.spec, spec) }], sources: {} });
    const live = await this.refresh(session, id, { force: true });
    return { ok: true, version: from + 1, from, warnings: made.app.render().warnings ?? [], data_errors: live.errors };
  }

  /** Every version of an app with what changed in it, newest last. */
  history(session, id) { return (this.running.get(key(session, id))?.history ?? []).map((h) => ({ version: h.version, at: h.at, changes: h.changes ?? [] })); }

  /** A spec app as plain JSON: its spec, version, history, and the data and settings the person entered. Live (http) data is fetched again on import. */
  snapshot(session, id) {
    const r = this.running.get(key(session, id));
    if (!r) return null;
    const coll = Object.entries(r.spec?.data ?? {}).filter(([, v]) => v?.source === "collection").map(([k]) => k);
    const data = Object.fromEntries(coll.filter((k) => k in r.app.data).map((k) => [k, JSON.parse(JSON.stringify(r.app.data[k]))]));
    return { spec: r.spec, version: r.version, history: this.history(session, id), data, state: JSON.parse(JSON.stringify(r.app.state)) };
  }

  /** Starts an app from a snapshot: same spec, version and history, with the data and settings put back. Resolves { ok, warnings, data_errors } or { ok: false, errors }. */
  async restore(session, id, snap, { style = "android", reduceMotion = false } = {}) {
    const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
    const skipped = [];
    const declared = plain(snap?.spec?.data) ? snap.spec.data : {};
    const data = {};
    for (const [k, rows] of Object.entries(plain(snap?.data) ? snap.data : {})) {
      if (declared[k]?.source !== "collection") { skipped.push(`data "${k}" is not a collection in the spec`); continue; }
      if (!Array.isArray(rows) || !rows.every(plain)) { skipped.push(`data "${k}" is not a list of records`); continue; }
      data[k] = rows;
    }
    const declaredState = plain(snap?.spec?.state) ? snap.spec.state : {};
    const state = {};
    for (const [k, v] of Object.entries(plain(snap?.state) ? snap.state : {})) {
      if (!(k in declaredState)) { skipped.push(`setting "${k}" is not in the spec`); continue; }
      state[k] = v;
    }
    const made = createApp(snap?.spec, { style, reduceMotion, data, state });
    if (!made.ok) return { ok: false, errors: made.errors };
    const version = Number.isInteger(Number(snap.version)) && Number(snap.version) > 0 ? Number(snap.version) : 1;
    const entries = (Array.isArray(snap.history) ? snap.history : []).filter(plain).map((h) => {
      const v = Number(h.version), at = Number(h.at);
      return { version: Number.isInteger(v) && v > 0 ? v : 1, at: Number.isFinite(at) ? at : Date.now(), changes: Array.isArray(h.changes) ? h.changes.map(String) : [] };
    });
    const history = entries.length ? entries : [{ version, at: Date.now(), changes: ["restored"] }];
    this.running.set(key(session, id), { app: made.app, spec: snap.spec, style, reduceMotion, version, history, sources: {} });
    const live = await this.refresh(session, id, { force: true });
    return { ok: true, warnings: [...(made.app.render().warnings ?? []), ...skipped], data_errors: live.errors };
  }

  version(session, id) { return this.running.get(key(session, id))?.version ?? null; }

  has(session, id) { return this.running.has(key(session, id)); }
  drop(session, id) { return this.running.delete(key(session, id)); }
  dropSession(session) { for (const k of [...this.running.keys()]) if (k.startsWith(`${session}/`)) this.running.delete(k); }

  /** The page for an app's current screen. */
  page(session, id) {
    const r = this.running.get(key(session, id));
    if (!r) return null;
    const out = r.app.render();
    if (!out.ok) return null;
    return out.html.replace("</body>", `<script id="sv-host">${HOST_SCRIPT}</script></body>`);
  }

  /** The screen as text for an agent: role and name of each node. */
  tree(session, id) {
    const r = this.running.get(key(session, id));
    const out = r?.app.render();
    return out?.ok ? out.tree : null;
  }

  /** Runs an action by name with the given input, as a generated tool does. Resolves { ok, value } or { ok: false, error }. */
  call(session, id, action, input = {}) {
    const r = this.running.get(key(session, id));
    if (!r) return { ok: false, error: "That app is not running" };
    const res = r.app.call(action, input);
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
      default: res = { ok: false, error: `unknown op '${body?.op}'` };
    }
    const out = a.render();
    const html = out.ok ? out.html.replace("</body>", `<script id="sv-host">${HOST_SCRIPT}</script></body>`) : undefined;
    return { ...(res.ok === false && "errors" in res ? { ok: false, error: Object.values(res.errors).join(" ") } : res), ...(html ? { html } : {}) };
  }
}
