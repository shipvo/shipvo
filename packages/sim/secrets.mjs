// The Secrets screen in the phone's Settings app: one row per saved key, with rotate, revoke and a use log.
// The screen shows metadata only (app, name, domain, access, last used). A value never reaches the page.
// The page talks to this server on /vault-ui/*; the server forwards four routes to the control plane and adds the owner token.

const ID = /^[\w.-]{1,64}$/;
const NAME = /^[\w.-]{1,64}$/;

/**
 * Maps a /vault-ui request to a control-plane path, or returns null when the route is not one of the four.
 * @returns {{ method: string, path: string } | null}
 */
export function vaultRoute(method, pathname, search = "") {
  if (!pathname.startsWith("/vault-ui/")) return null;
  const parts = pathname.slice("/vault-ui/".length).split("/");
  if (parts[0] !== "keys") return null;
  if (parts.length === 1 && method === "GET") {
    const app = new URLSearchParams(search).get("app") ?? "";
    return ID.test(app) ? { method, path: `/vault/keys?app=${encodeURIComponent(app)}` } : null;
  }
  const [, app, name, tail] = parts;
  if (!ID.test(app ?? "") || !NAME.test(name ?? "")) return null;
  const base = `/vault/keys/${app}/${name}`;
  if (parts.length === 3 && method === "DELETE") return { method, path: base };
  if (parts.length === 4 && tail === "rotate" && method === "POST") return { method, path: `${base}/rotate` };
  if (parts.length === 4 && tail === "uses" && method === "GET") return { method, path: `${base}/uses` };
  return null;
}

/** True when the Host header names this machine (loopback) on the given port. Stops DNS rebinding. */
export function loopbackHost(host) {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(String(host ?? ""));
}

/** True when the request is same-origin: an Origin header, if present, has the same host as Host; a browser's Sec-Fetch-Site must not say cross-site. */
export function sameOrigin(headers) {
  const site = headers["sec-fetch-site"];
  if (site && site !== "same-origin") return false;
  const origin = headers.origin;
  if (origin === undefined) return true;
  try { return new URL(origin).host === headers.host; } catch { return false; }
}

/**
 * Checks and forwards one /vault-ui request. Returns { status, body } to send back.
 * `fetchImpl` and `token` are injected so tests need no network.
 */
export async function forwardVault(req, { control, token, fetchImpl = fetch }) {
  const { method, pathname, search, headers } = req;
  if (!loopbackHost(headers.host)) return { status: 403, body: { error: "forbidden_host" } };
  if (!sameOrigin(headers)) return { status: 403, body: { error: "cross_origin" } };
  const route = vaultRoute(method, pathname, search);
  if (!route) return { status: 404, body: { error: "not_found" } };
  if (!token) return { status: 503, body: { error: "no_owner_token", message: "Sign in as the owner to manage saved keys." } };
  try {
    const r = await fetchImpl(`${control}${route.path}`, { method: route.method, headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = { error: "bad_response" }; }
    return { status: r.status, body: scrub(body) };
  } catch {
    return { status: 502, body: { error: "unreachable" } };
  }
}

// Belt and braces: drop anything that looks like a value from a response before it reaches the page.
const SECRET_FIELDS = new Set(["value", "secret", "ciphertext", "wrapped_key", "plaintext"]);
function scrub(x) {
  if (Array.isArray(x)) return x.map(scrub);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).filter(([k]) => !SECRET_FIELDS.has(k)).map(([k, v]) => [k, scrub(v)]));
  return x;
}

/** Plain-text view of the Secrets screen for an agent. */
export function describeKeys(keys) {
  return ["Secrets", ...(keys.length ? keys.map((k) => `- ${k.app} / ${k.name} (${k.domain}, ${k.access}, last used ${k.last_used_at ?? "never"})`) : ["- no saved keys"])].join("\n");
}

/** The row in the Settings screen that opens Secrets. */
export function secretsRowHtml() {
  return `<button type="button" class="sf-srow" data-part="secrets-open">Secrets</button>`;
}
/** Markup for the Secrets screen. Hidden until opened. The rows are drawn by the client script. */
export function secretsHtml() {
  return `<div class="sf-settings sf-secrets" data-part="secrets-screen" role="dialog" aria-label="Secrets" tabindex="-1" hidden><h2 class="sf-sh">Secrets</h2><p data-part="secrets-note" role="status"></p><div data-part="secrets-rows" role="list" aria-label="Saved keys"></div><button type="button" class="sf-close" data-part="secrets-close">Back</button></div>`;
}

export const secretsCss = [
  `.sf-secrets{z-index:9}.sf-secrets[hidden]{display:none}.sf-key{margin:8px 0;padding:12px;border-radius:14px;background:#2c3036}.sf-key b{display:block}.sf-key small{display:block;opacity:.75;margin-top:2px}`,
  `.sf-key .sf-acts{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}.sf-key button{padding:8px 12px;border:1px solid #fff6;border-radius:999px;background:transparent;color:#fff;font:inherit}.sf-key button[data-act=revoke]{border-color:#ff7b72;color:#ff7b72}`,
  `.sf-uses{margin:8px 0 0;padding:0;list-style:none;font-size:13px}.sf-uses li{padding:2px 0}.sf-secrets a{color:#4da3ff;word-break:break-all}`,
  `.sf-secrets :focus-visible{outline:3px solid #4da3ff;outline-offset:2px}`,
].join("\n");

/** Browser script: opens Secrets from Settings, lists keys, rotates, revokes and shows the use log. Calls /vault-ui/* on the page's own origin. */
export function secretsClientScript(app = "") {
  return `(function(){
var r=document.querySelector('[data-part="phone-body"]');if(!r)return;
var q=function(p){return r.querySelector('[data-part="'+p+'"]')},sc=q("secrets-screen");if(!sc)return;
var APP=${JSON.stringify(app)};
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function api(m,p){return fetch("/vault-ui/"+p,{method:m}).then(function(x){return x.json().then(function(b){return{ok:x.ok,body:b}})})}
function app(){return APP||(new URLSearchParams(location.search).get("app"))||"default"}
function note(t){q("secrets-note").textContent=t||""}
function key(k){return encodeURIComponent(k.app)+"/"+encodeURIComponent(k.name)}
function load(){api("GET","keys?app="+encodeURIComponent(app())).then(function(x){var rows=q("secrets-rows");
if(!x.ok){rows.innerHTML="";note(x.body.message||"Could not load saved keys.");return}
var ks=x.body.keys||[];note(ks.length?"":"No saved keys.");
rows.innerHTML=ks.map(function(k){return '<div class="sf-key" role="listitem" data-app="'+esc(k.app)+'" data-name="'+esc(k.name)+'"><b>'+esc(k.name)+'</b><small>'+esc(k.app)+' · '+esc(k.domain)+' · '+esc(k.access)+' · last used '+esc(k.last_used_at||"never")+'</small><div class="sf-acts"><button type="button" data-act="rotate">Rotate</button><button type="button" data-act="revoke">Revoke</button><button type="button" data-act="uses">Use log</button></div><div data-part="key-extra"></div></div>'}).join("")})}
function show(on){sc.hidden=!on;if(on){load();sc.focus({preventScroll:true})}}
r.addEventListener("click",function(e){var t=e.target;if(!t.closest)return;
if(t.closest('[data-part="secrets-open"]'))return show(true);
if(t.closest('[data-part="secrets-close"]'))return show(false);
var b=t.closest("[data-act]");if(!b)return;var row=b.closest(".sf-key"),k={app:row.getAttribute("data-app"),name:row.getAttribute("data-name")},ex=row.querySelector('[data-part="key-extra"]'),a=b.getAttribute("data-act");
if(a==="revoke")api("DELETE","keys/"+key(k)).then(function(x){if(x.ok){row.remove();note("Revoked "+k.name+".")}else note(x.body.message||"Could not revoke.")});
if(a==="rotate")api("POST","keys/"+key(k)+"/rotate").then(function(x){if(x.ok&&/^https?:\\/\\//.test(x.body.url||""))ex.innerHTML='<p>One-time link to save the new key (expires in '+esc(Math.round((x.body.expires_in||0)/60))+' min):</p><a href="'+esc(x.body.url)+'" target="_blank" rel="noopener">'+esc(x.body.url)+'</a>';else note(x.body.message||"Could not rotate.")});
if(a==="uses")api("GET","keys/"+key(k)+"/uses").then(function(x){var u=x.body.uses||[];ex.innerHTML=u.length?'<ul class="sf-uses">'+u.map(function(i){return'<li>'+esc(i.at)+' · '+esc(i.app)+' · '+esc(i.host)+'</li>'}).join("")+'</ul>':'<p>Not used yet.</p>'})});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!sc.hidden)show(false)});
})();`;
}
