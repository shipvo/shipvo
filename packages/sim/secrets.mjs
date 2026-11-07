// The Secrets screen inside Settings: one row per saved key, with rotate and revoke, and a use log.
// It shows metadata only (app, name, domain, access, last used). No value is ever fetched or drawn.
// The frame page calls the sim server at /vault-ui/*, which forwards to the control plane's /vault/secrets routes.

/** Route of a Secrets request after /vault-ui/, or null. Only these four shapes are forwarded. */
export function secretsRoute(method, path) {
  const m = /^secrets\/([a-z0-9][a-z0-9_-]{0,63})(?:\/([A-Za-z][A-Za-z0-9_]{0,63})(\/rotate|\/uses)?)?$/.exec(path);
  if (!m) return null;
  const [, app, name, tail] = m;
  const ok = !name ? method === "GET" : !tail ? method === "DELETE" : tail === "/rotate" ? method === "POST" : method === "GET";
  return ok ? `/vault/${path}` : null;
}

/** True when the Host header names a loopback host (blocks DNS rebinding). */
export function loopbackHost(host) {
  if (!host) return false;
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL("http://" + host).hostname); } catch { return false; }
}

/** True when the request comes from the sim's own page: no Origin header (same-origin GET) or an Origin equal to the Host. */
export function sameOrigin(headers) {
  if (!loopbackHost(headers.host)) return false;
  const o = headers.origin;
  if (o === undefined) return headers["sec-fetch-site"] === undefined || headers["sec-fetch-site"] === "same-origin" || headers["sec-fetch-site"] === "none";
  try { return !!headers.host && new URL(o).host === headers.host; } catch { return false; }
}

/**
 * Handle one /vault-ui/ request. Returns { status, body }. Foreign origins get 403 and never reach the control plane.
 * `rest` is the path after /vault-ui/. `app()` gives the active app for `app`.
 */
export async function vaultUi({ method, rest, headers, token, control, fetchImpl = fetch, app }) {
  if (!sameOrigin(headers)) return { status: 403, body: { error: "forbidden", message: "Secrets can only be managed from the simulator's own page." } };
  if (method === "OPTIONS") return { status: 204, body: "" };
  if (rest === "app" && method === "GET") return { status: 200, body: { app: app() ?? null } };
  const target = secretsRoute(method, rest);
  if (!target) return { status: 404, body: { error: "not_found", message: "Not found." } };
  if (!token) return { status: 401, body: { error: "unauthorized", message: "Set PN_OWNER_TOKEN to manage saved keys." } };
  const r = await fetchImpl(control + target, { method, headers: { authorization: `Bearer ${token}` } }).catch(() => null);
  if (!r) return { status: 502, body: { error: "unreachable", message: "The control plane could not be reached." } };
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const when = (t) => (t ? t.replace("T", " ").slice(0, 16) : "never");

/** Plain-text view for an agent or a test. Never includes a value. */
export function describeSecrets(list) {
  if (!list.length) return "Secrets\nNo saved keys.";
  return ["Secrets", ...list.map((s) => `- ${s.app} / ${s.name}: ${s.domain}, ${s.access} access, last used ${when(s.last_used_at)}`)].join("\n");
}

const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function secretsRowHtml(s) {
  const e = esc;
  return `<div class="sf-secret" role="group" aria-label="${e(s.name)}" data-secret="${e(s.name)}" data-app="${e(s.app)}"><b>${e(s.name)}</b><span>${e(s.app)} · ${e(s.domain)} · ${e(s.access)} access · last used ${e(when(s.last_used_at))}</span><div class="sf-opts"><button type="button" class="sf-opt" data-secret-act="rotate">Rotate</button><button type="button" class="sf-opt" data-secret-act="revoke">Revoke</button><button type="button" class="sf-opt" data-secret-act="uses">Use log</button></div></div>`;
}

export function useLogHtml(uses) {
  const e = esc;
  return uses.length ? `<ul class="sf-uses">${uses.map((u) => `<li>${e(when(u.at))} · ${e(u.app)} · ${e(u.host)} · ${e(u.outcome)}</li>`).join("")}</ul>` : `<p>No calls yet.</p>`;
}

export const secretsButtonHtml = () => `<button type="button" class="sf-srow" data-part="secrets-open">Secrets</button>`;
export const secretsCss = `.sf-secret{margin:6px 0;padding:10px 12px;border-radius:14px;background:rgba(128,128,128,.22);color:inherit}.sf-secret b{display:block}.sf-secret span{display:block;opacity:.8;font-size:13px;margin:2px 0 6px}.sf-uses{margin:6px 0;padding-inline-start:18px;font-size:13px}.sf-slink{margin:8px 0;padding:10px 12px;border-radius:14px;background:rgba(128,128,128,.22);color:inherit}.sf-slink a{color:inherit;text-decoration:underline}.sf-err{margin:8px 0}`;

/** Browser script: draws the list inside the Settings rows area and runs the actions. Rendering uses the pure helpers above. */
export function secretsClientScript(base = "/vault-ui") {
  return `(function(){
var BASE=${JSON.stringify(base)},APP="",when=${when.toString()},esc=${esc.toString()},rowHtml=${secretsRowHtml.toString()},logHtml=${useLogHtml.toString()};
var r=document.querySelector('[data-part="phone-body"]');if(!r)return;
var rows=r.querySelector('[data-part="settings-rows"]'),sc=r.querySelector('[data-part="settings-screen"]');if(!rows||!sc)return;
var SESSION=(typeof location!=="undefined"&&new URLSearchParams(location.search).get("session"))||"";
var box=document.createElement("div");box.setAttribute("data-part","secrets");box.setAttribute("role","region");box.setAttribute("aria-label","Secrets");box.hidden=true;sc.insertBefore(box,sc.querySelector('[data-part="settings-close"]'));
var open=false;
function j(m,p){return fetch(BASE+"/"+p,{method:m}).then(function(x){return x.json().catch(function(){return {}}).then(function(d){if(!x.ok)throw new Error(d.message||("Request failed ("+x.status+")."));return d})})}
function note(t){var n=box.querySelector(".sf-err");if(!n){n=document.createElement("p");n.className="sf-err";n.setAttribute("role","alert");box.appendChild(n)}n.textContent=t}
function app(){return APP?Promise.resolve(APP):j("GET","app"+(SESSION?"?session="+encodeURIComponent(SESSION):"")).then(function(d){if(!d.app)throw new Error("No app is open on this phone.");APP=d.app;return APP})}
function load(){app().then(function(a){return j("GET","secrets/"+a)}).then(function(d){box.innerHTML='<h3>Secrets for '+esc(APP)+'</h3>'+((d.secrets||[]).map(rowHtml).join("")||"<p>No saved keys.</p>")}).catch(function(e){APP="";box.innerHTML="<h3>Secrets</h3>";note(e.message||"Secrets could not be loaded.")})}
function setOpen(on){open=on;box.hidden=!on;rows.hidden=on;if(on)load()}
function close(){setOpen(false)}
function ask(row,n,done){var old=row.querySelector(".sf-confirm");if(old)old.remove();var c=document.createElement("div");c.className="sf-slink sf-confirm";c.setAttribute("role","alertdialog");c.setAttribute("aria-label","Revoke "+n);
c.innerHTML='<p></p><div class="sf-opts"><button type="button" class="sf-opt" data-confirm="yes">Revoke</button><button type="button" class="sf-opt" data-confirm="no">Keep</button></div>';
c.querySelector("p").textContent="Revoke "+n+"? Apps will ask for a new one.";row.appendChild(c);
c.addEventListener("click",function(e){var t=e.target.closest&&e.target.closest("[data-confirm]");if(!t)return;var y=t.getAttribute("data-confirm")==="yes";c.remove();if(y)done()});
c.addEventListener("keydown",function(e){if(e.key==="Escape"){e.stopPropagation();c.remove()}});c.querySelector('[data-confirm="no"]').focus()}
r.addEventListener("click",function(e){var t=e.target;if(!t.closest)return;
if(t.closest('[data-part="settings-close"]')){close();return}
if(t.closest('[data-part="secrets-open"]')){setOpen(!open);return}
var b=t.closest("[data-secret-act]"),row=t.closest("[data-secret]");if(!b||!row)return;
var n=row.getAttribute("data-secret"),a=b.getAttribute("data-secret-act"),base="secrets/"+APP+"/"+n;
if(a==="revoke"){ask(row,n,function(){j("DELETE",base).then(load).catch(function(x){note(x.message)})})}
else if(a==="rotate"){j("POST",base+"/rotate").then(function(d){var l=document.createElement("div");l.className="sf-slink";l.innerHTML='<p>The old key keeps working until you save the new one.</p><a target="_blank" rel="noopener">Open the one-time page to save a new key</a>';l.querySelector("a").href=d.url;row.appendChild(l)}).catch(function(x){note(x.message)})}
else if(a==="uses"){j("GET",base+"/uses").then(function(d){var o=row.querySelector(".sf-uses,p");if(o)o.remove();row.insertAdjacentHTML("beforeend",logHtml(d.uses||[]))}).catch(function(x){note(x.message)})}});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&open&&!e.defaultPrevented&&!box.querySelector(".sf-confirm"))close()});
new MutationObserver(function(){if(sc.hidden&&open)close()}).observe(sc,{attributes:true,attributeFilter:["hidden"]});
rows.insertAdjacentHTML("afterend",'<button type="button" class="sf-srow" data-part="secrets-open">Secrets</button>');
})();`;
}
