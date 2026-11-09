// Runs app specs on the simulated phone. A spec app is a JSON document (see @shipvo/spec). This host keeps one running
// app per phone and app id, renders its screen as a page the phone shows, and applies the taps, typing and choices
// that page sends back. The page is real HTML with labelled controls, so the screen and tap tools work on it as on any app.
import { createApp } from "@shipvo/spec";

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

export class SpecHost {
  constructor() { this.running = new Map(); }

  /** Starts an app from a spec. Resolves { ok: true } or { ok: false, errors } with a JSON path and a fix for each problem. */
  create(session, id, spec, { style = "android", reduceMotion = false } = {}) {
    const made = createApp(spec, { style, reduceMotion });
    if (!made.ok) return { ok: false, errors: made.errors };
    this.running.set(key(session, id), { app: made.app, spec, style, reduceMotion });
    return { ok: true, warnings: made.app.render().warnings ?? [] };
  }

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
