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

const when = (t) => (t ? t.replace("T", " ").slice(0, 16) : "never");

/** Plain-text view for an agent or a test. Never includes a value. */
export function describeSecrets(list) {
  if (!list.length) return "Secrets\nNo saved keys.";
  return ["Secrets", ...list.map((s) => `- ${s.app} / ${s.name}: ${s.domain}, ${s.access} access, last used ${when(s.last_used_at)}`)].join("\n");
}

export function secretsRowHtml(s) {
  const e = (x) => String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  return `<div class="sf-secret" role="group" aria-label="${e(s.name)}" data-secret="${e(s.name)}" data-app="${e(s.app)}"><b>${e(s.name)}</b><span>${e(s.app)} · ${e(s.domain)} · ${e(s.access)} access · last used ${e(when(s.last_used_at))}</span><div class="sf-opts"><button type="button" class="sf-opt" data-secret-act="rotate">Rotate</button><button type="button" class="sf-opt" data-secret-act="revoke">Revoke</button><button type="button" class="sf-opt" data-secret-act="uses">Use log</button></div></div>`;
}

export function useLogHtml(uses) {
  const e = (x) => String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  return uses.length ? `<ul class="sf-uses">${uses.map((u) => `<li>${e(when(u.at))} · ${e(u.app)} · ${e(u.host)} · ${e(u.outcome)}</li>`).join("")}</ul>` : `<p>No calls yet.</p>`;
}

export const secretsButtonHtml = () => `<button type="button" class="sf-srow" data-part="secrets-open">Secrets</button>`;
export const secretsCss = `.sf-secret{margin:6px 0;padding:10px 12px;border-radius:14px;background:#2c3036}.sf-secret b{display:block}.sf-secret span{display:block;opacity:.8;font-size:13px;margin:2px 0 6px}.sf-uses{margin:6px 0;padding-inline-start:18px;font-size:13px}.sf-slink{margin:8px 0;padding:10px 12px;border-radius:14px;background:#2c3036}.sf-slink a{color:#9cc8ff}`;

/** Browser script: draws the list inside the Settings rows area and runs the actions. Rendering uses the pure helpers above. */
export function secretsClientScript(base = "/vault-ui") {
  return `(function(){
var BASE=${JSON.stringify(base)},APP=(document.body&&document.body.getAttribute("data-app"))||(typeof location!=="undefined"&&new URLSearchParams(location.search).get("app"))||"",when=${when.toString()},rowHtml=${secretsRowHtml.toString()},logHtml=${useLogHtml.toString()};
var r=document.querySelector('[data-part="phone-body"]');if(!r||!APP)return;
var rows=r.querySelector('[data-part="settings-rows"]'),sc=r.querySelector('[data-part="settings-screen"]');if(!rows||!sc)return;
var box=document.createElement("div");box.setAttribute("data-part","secrets");box.setAttribute("role","region");box.setAttribute("aria-label","Secrets");box.hidden=true;sc.insertBefore(box,sc.querySelector('[data-part="settings-close"]'));
var open=false;
function j(m,p){return fetch(BASE+"/"+p,{method:m}).then(function(x){return x.json()})}
function load(){j("GET","secrets/"+APP).then(function(d){box.innerHTML='<h3>Secrets</h3>'+((d.secrets||[]).map(rowHtml).join("")||"<p>No saved keys.</p>")}).catch(function(){box.textContent="Secrets could not be loaded."})}
function toggle(){open=!open;box.hidden=!open;rows.hidden=open;if(open)load()}
r.addEventListener("click",function(e){var t=e.target;if(!t.closest)return;
if(t.closest('[data-part="secrets-open"]')){toggle();return}
var b=t.closest("[data-secret-act]"),row=t.closest("[data-secret]");if(!b||!row)return;
var n=row.getAttribute("data-secret"),a=b.getAttribute("data-secret-act"),base="secrets/"+APP+"/"+n;
if(a==="revoke"){j("DELETE",base).then(load)}
else if(a==="rotate"){j("POST",base+"/rotate").then(function(d){var l=document.createElement("div");l.className="sf-slink";l.innerHTML=d.url?'<a target="_blank" rel="noopener">Open the one-time page to save a new key</a>':"Could not start a rotation.";if(d.url)l.querySelector("a").href=d.url;row.appendChild(l)})}
else if(a==="uses"){j("GET",base+"/uses").then(function(d){var o=row.querySelector(".sf-uses,p");if(o)o.remove();row.insertAdjacentHTML("beforeend",logHtml(d.uses||[]))})}});
var s=rows.parentNode.querySelector('[data-part="settings-rows"]');s.insertAdjacentHTML("afterend",'<button type="button" class="sf-srow" data-part="secrets-open">Secrets</button>');
})();`;
}
