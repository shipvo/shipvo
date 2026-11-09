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

export class SpecHost {
  /**
   * @param opts.fetch  how live data is fetched (default: the global fetch). Same shape as RunContext.fetch.
   * @param opts.now    clock in ms, for tests.
   * @param opts.onChange  called with (session, id) when background refresh changed an app's data.
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
   * Resolves { updated: [names], errors: [{ source, code, message }] }.
   */
  async refresh(session, id, { force = false } = {}) {
    const r = this.running.get(key(session, id));
    if (!r) return { updated: [], errors: [{ source: "", code: "not_running", message: "That app is not running" }] };
    const updated = [], errors = [];
    for (const [name, src] of Object.entries(r.spec.data ?? {})) {
      if (src?.source !== "http") continue;
      const info = (r.sources[name] ??= { at: 0 });
      if (!force && info.at && this.now() - info.at < refreshEvery(src)) continue;
      info.at = this.now();
      try {
        r.app.data[name] = await runSource(r.spec, name, { fetch: this.fetch, secrets: () => ({ refused: "unavailable" }), scope: { state: r.app.state, data: r.app.data } });
        info.ok = true; delete info.error; updated.push(name);
      } catch (e) {
        const code = e instanceof RunError ? e.code : "fetch_failed";
        info.ok = false; info.error = { code, message: String(e?.message ?? e).split("\n")[0] };
        errors.push({ source: name, ...info.error });
      }
    }
    return { updated, errors };
  }

  /** Checks every running app for due data. Call it on a timer. Tells `onChange` about apps whose data changed. */
  async tick() {
    for (const k of [...this.running.keys()]) {
      const [session, id] = [k.slice(0, k.lastIndexOf("/")), k.slice(k.lastIndexOf("/") + 1)];
      const out = await this.refresh(session, id);
      if (out.updated.length) this.onChange?.(session, id, out);
    }
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
    this.running.set(key(session, id), { app: made.app, spec, style, reduceMotion, version: 1, history: [{ version: 1, at: Date.now() }], sources: {} });
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
    this.running.set(key(session, id), { ...cur, app: made.app, spec, version: from + 1, history: [...cur.history, { version: from + 1, at: Date.now() }], sources: {} });
    const live = await this.refresh(session, id, { force: true });
    return { ok: true, version: from + 1, from, warnings: made.app.render().warnings ?? [], data_errors: live.errors };
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
