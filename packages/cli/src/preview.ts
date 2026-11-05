// `shipvo preview`: build the web artifact with the simulated device, wrap it in a phone-sized frame page
// and publish it to here.now with no account. The link is public and lasts 24 hours unless claimed.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep, extname } from "node:path";
import { PANEL_JS } from "./previewPanel.js";
import { args as parse, loadConfig } from "./config.js";

const API = "https://here.now/api/v1";
const CLIENT = "shipvo/cli";

export type PreviewFile = { path: string; bytes: Uint8Array; contentType: string };
export type PreviewResult = { url: string; claimUrl: string | null; expiresAt: string | null; files: number; warnings: string[] };
export type PreviewOpts = { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxRetries?: number };

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".ico": "image/x-icon", ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm",
};
const typeOf = (p: string) => TYPES[extname(p).toLowerCase()] ?? "application/octet-stream";

// Files that never leave the machine, wherever they sit in the tree.
const BLOCKED_SEGMENTS = new Set([".shipvo", ".git", "node_modules", ".herenow"]);
const BLOCKED_NAME = /^(\.env.*|.*\.map|.*\.(pem|key|p8|p12|jks|keystore|mobileprovision)|seed\.txt|publish-token|id_rsa|id_ed25519)$/i;
export const blockedPath = (rel: string) => {
  const segs = rel.split(/[\\/]/);
  return segs.some((s) => BLOCKED_SEGMENTS.has(s)) || BLOCKED_NAME.test(segs[segs.length - 1]);
};

const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/SHIPVO_SIGNING_SEED\s*["']?\s*[:=]/, "SHIPVO_SIGNING_SEED"],
  [/SHIPVO_PUBLISH_TOKEN\s*["']?\s*[:=]/, "SHIPVO_PUBLISH_TOKEN"],
  [/CLOUDFLARE_API_TOKEN\s*["']?\s*[:=]/, "CLOUDFLARE_API_TOKEN"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, "a GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key"],
  [/\bsk-[A-Za-z0-9_-]{32,}/, "an API key"],
];
const TEXT = /\.(html|js|mjs|css|json|txt|svg)$/i;

/** Secret values this process knows: they must not appear in anything we upload. */
function knownSecrets(): string[] {
  const e = process.env;
  const out = [e.SHIPVO_SIGNING_SEED, e.PURENATIVE_SIGNING_SEED, e.SHIPVO_PUBLISH_TOKEN, e.CLOUDFLARE_API_TOKEN];
  for (const f of [join(process.cwd(), ".shipvo", "seed.txt"), join(process.cwd(), ".shipvo", "publish-token")]) {
    try { out.push(readFileSync(f, "utf8").trim()); } catch {}
  }
  return out.filter((s): s is string => !!s && s.length >= 16);
}

/** Throws if any file would leak a secret. Names the file and the kind, never the value. */
export function refuseSecrets(files: PreviewFile[], secrets: string[] = knownSecrets()) {
  for (const f of files) {
    if (!TEXT.test(f.path)) continue;
    const text = Buffer.from(f.bytes).toString("utf8");
    for (const s of secrets) if (text.includes(s)) throw new Error(`Refusing to publish: ${f.path} contains a secret value from your environment or .shipvo/. Remove it from the app's web build and run again.`);
    for (const [re, what] of SECRET_PATTERNS) if (re.test(text)) throw new Error(`Refusing to publish: ${f.path} references ${what}. Keep secrets out of the web build and run again.`);
  }
}

/** Reads a build folder into upload entries, skipping files that must never be uploaded. */
export function collectFiles(dir: string): PreviewFile[] {
  const out: PreviewFile[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name), rel = relative(dir, full).split(sep).join("/");
      if (blockedPath(rel)) continue;
      if (statSync(full).isDirectory()) walk(full);
      else out.push({ path: rel, bytes: new Uint8Array(readFileSync(full)), contentType: typeOf(rel) });
    }
  };
  walk(dir);
  return out;
}

/** The page people open: the app in a phone frame (Android or iPhone skin) with a device panel beside it. */
export function framePage(name: string): string {
  const title = name.replace(/[<>&"']/g, "");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title} preview</title>
<style>
:root{color-scheme:light}body.dark{color-scheme:dark}
html,body{margin:0;min-height:100%;font:14px system-ui,sans-serif;background:#e8eaed;color:#111}
body.dark{background:#15171a;color:#eee}
.bar{display:flex;gap:8px;justify-content:center;align-items:center;padding:10px;flex-wrap:wrap}
button,input,select,textarea{font:inherit}
.bar button,.panel button{padding:6px 12px;border:1px solid #888;border-radius:8px;background:transparent;color:inherit;cursor:pointer}
.bar button[aria-pressed=true],.panel button[aria-pressed=true]{background:#2563eb;border-color:#2563eb;color:#fff}
.layout{display:flex;gap:20px;justify-content:center;align-items:flex-start;padding:0 10px 20px;flex-wrap:wrap}
.device{position:relative;display:flex;flex-direction:column;background:#000;border-radius:28px;box-shadow:0 8px 30px #0005;overflow:hidden;max-width:100%}
.device.ios{border-radius:44px}
.status{display:flex;justify-content:space-between;align-items:center;height:26px;padding:0 18px;color:#fff;font-size:12px;background:#000;position:relative}
.ios .status{height:44px;padding:8px 28px 0}.ios .status:after{content:"";position:absolute;left:50%;top:10px;width:96px;height:26px;margin-left:-48px;border-radius:14px;background:#111;border:1px solid #333}
.nav{display:flex;justify-content:center;align-items:center;height:36px;background:#000;color:#fff}
.nav button{background:transparent;border:0;color:#fff;font-size:18px;padding:4px 24px;cursor:pointer}
.ios .nav{height:26px}.ios .nav button{display:none}.ios .nav:after{content:"";width:120px;height:4px;border-radius:2px;background:#fff}
.ios .edge{display:block}.edge{display:none;position:absolute;left:0;top:44px;bottom:26px;width:14px;z-index:5;cursor:w-resize}
iframe{border:0;background:#fff;width:100%;flex:1;min-height:0}
.shield{position:absolute;inset:0;z-index:6;display:none;cursor:crosshair;background:rgba(37,99,235,.08)}
.device.commenting .shield{display:block}
.pin{position:absolute;z-index:7;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:#f59e0b;color:#000;font-size:11px;text-align:center;line-height:18px}
.panel{width:300px;max-width:100%;box-sizing:border-box;background:#fff;color:#111;border-radius:14px;padding:14px;box-shadow:0 4px 18px #0003;display:grid;gap:10px}
body.dark .panel{background:#22262b;color:#eee}
.panel h2{font-size:15px;margin:0}.panel fieldset{border:1px solid #8884;border-radius:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0;padding:8px}
.panel legend{font-weight:600;font-size:12px}.panel input,.panel select,.panel textarea{padding:5px;border:1px solid #888;border-radius:6px;background:transparent;color:inherit;max-width:100%;box-sizing:border-box}
.panel input.n{width:90px}.panel .msg{min-height:1.2em;font-size:12px;color:#b45309}
.panel .honest{font-size:12px;opacity:.8;margin:0}.panel ol{margin:0;padding-left:18px;font-size:12px}
.note{text-align:center;opacity:.7;padding:0 12px 16px}
@media (max-width:500px){.bar,.note{display:none}.layout{padding:0;gap:0}.device{width:100vw!important;height:100vh!important;height:100dvh!important;border-radius:0;box-shadow:none}.panel{width:auto;margin:10px;flex:1 1 100%}}
</style></head><body>
<div class="bar" role="toolbar" aria-label="Preview options">
<button data-device="phone" aria-pressed="true">Phone</button><button data-device="large" aria-pressed="false">Large phone</button><button data-device="iphone" aria-pressed="false">iPhone</button><button data-device="tablet" aria-pressed="false">Tablet</button>
<button id="theme" aria-pressed="false">Dark</button></div>
<div class="layout">
<div class="device android" id="device"><div class="status"><span>9:41</span><span>5G ▮▮▮ 100%</span></div><div class="edge" id="edge" title="Swipe back"></div>
<iframe id="app" src="app.html" title="${title}"></iframe><div class="shield" id="shield"></div>
<div class="nav"><button id="back" aria-label="Back">◀</button></div></div>
<section class="panel" aria-label="Device panel"><h2>Device panel</h2>
<fieldset><legend>Location</legend><select id="loc"><option value="4.0225,9.6967">Douala</option><option value="48.8566,2.3522">Paris</option><option value="40.7128,-74.006">New York</option><option value="-1.2921,36.8219">Nairobi</option></select><button id="loc-set">Set</button>
<input class="n" id="lat" aria-label="Latitude" placeholder="lat"><input class="n" id="lng" aria-label="Longitude" placeholder="lng"><button id="loc-xy">Use</button></fieldset>
<fieldset><legend>Camera</legend><select id="cam"><option value="">Nothing in view</option><option value="qr|https://example.com/ticket/42">QR code</option><option value="ean13|5901234123457">Barcode (EAN-13)</option></select><button id="cam-set">Show</button></fieldset>
<fieldset><legend>Fingerprint or Face ID</legend><button id="bio-ok">Match</button><button id="bio-no">No match</button></fieldset>
<fieldset><legend>Payment</legend><button id="pay-ok">Approve</button><button id="pay-no">Decline</button></fieldset>
<fieldset><legend>Network</legend><button id="net-on">Online</button><button id="net-off">Offline</button></fieldset>
<fieldset><legend>Push notification</legend><input id="pt" aria-label="Title" placeholder="Title"><input id="pb" aria-label="Body" placeholder="Body"><button id="push">Send</button></fieldset>
<fieldset><legend>Comment</legend><button id="cm" aria-pressed="false">Comment</button><textarea id="cn" aria-label="Note" rows="2" placeholder="Tap Comment, then the spot, then write a note"></textarea><button id="cs">Add note</button><ol id="cl"></ol><button id="cx">Download notes</button></fieldset>
<fieldset><legend>Save as test</legend><button id="st">Download test</button></fieldset>
<div class="msg" id="msg" role="status"></div>
<p class="honest">Every device event here is simulated. This is the app's web build on Shipvo's simulated device, measured against real Android and iOS in docs/parity-results.md. Native-only UI (custom native views, platform-native components, some gestures and animations) can differ, so confirm on a phone or emulator before release.</p>
</section></div>
<p class="note">${title}: simulated device, public preview. System sheets such as permissions and payments are simulated.</p>
<script>
${PANEL_JS}
var S={phone:[360,760,"android"],large:[412,915,"android"],iphone:[390,844,"ios"],tablet:[820,1180,"android"]},f=document.getElementById("app"),dv=document.getElementById("device"),P=null,pin=null,$=function(i){return document.getElementById(i)};
function skin(k){dv.className="device "+k+(dv.classList.contains("commenting")?" commenting":"");try{if(P)P.platform(k)}catch(e){}}
document.querySelectorAll("[data-device]").forEach(function(b){b.onclick=function(){var s=S[b.dataset.device];dv.style.width=s[0]+"px";dv.style.height=s[1]+"px";skin(s[2]);document.querySelectorAll("[data-device]").forEach(function(o){o.setAttribute("aria-pressed",o===b)})}});
dv.style.width="360px";dv.style.height="760px";
var t=$("theme");t.onclick=function(){var d=!document.body.classList.contains("dark");document.body.classList.toggle("dark",d);t.setAttribute("aria-pressed",d);t.textContent=d?"Light":"Dark";f.style.colorScheme=d?"dark":"light"};
function say(m){$("msg").textContent=m||""}
function run(fn,ok){return function(){try{say("");fn();if(ok)say(ok)}catch(e){say(e.message)}}}
function down(name,text){var a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type:"text/plain"}));a.download=name;a.click();URL.revokeObjectURL(a.href)}
f.addEventListener("load",function(){
  $("cl").textContent="";dv.querySelectorAll(".pin").forEach(function(n){n.remove()});pin=null;
  P=shipvoPanel(f.contentWindow,${JSON.stringify(title)});
  var d=f.contentDocument;
  d.addEventListener("click",function(e){P.tap(e.target)},true);
  d.addEventListener("change",function(e){if(e.target&&e.target.value!==undefined)P.type(e.target,e.target.value)},true);
});
function need(){if(!P)throw new Error("The app is still loading.");return P}
$("loc-set").onclick=run(function(){var v=$("loc").value.split(",");need().location(v[0],v[1])});
$("loc-xy").onclick=run(function(){need().location($("lat").value,$("lng").value)});
$("cam-set").onclick=run(function(){var v=$("cam").value.split("|");need().camera(v[0],v[1])});
$("bio-ok").onclick=run(function(){need().biometrics(true)},"Next fingerprint check: match");$("bio-no").onclick=run(function(){need().biometrics(false)},"Next fingerprint check: no match");
$("pay-ok").onclick=run(function(){need().payment(true)},"Next payment: approved");$("pay-no").onclick=run(function(){need().payment(false)},"Next payment: declined");
$("net-on").onclick=run(function(){need().network("online")},"Network: online");$("net-off").onclick=run(function(){need().network("offline")},"Network: offline");
$("push").onclick=run(function(){need().push($("pt").value,$("pb").value)});
$("back").onclick=run(function(){need().back()});$("edge").onclick=$("back").onclick;
$("st").onclick=run(function(){down("recorded.test.ts",need().toTest())});
$("cm").onclick=function(){var on=!dv.classList.contains("commenting");dv.classList.toggle("commenting",on);this.setAttribute("aria-pressed",on)};
$("shield").onclick=function(e){var r=dv.getBoundingClientRect();pin=[Math.round(e.clientX-r.left),Math.round(e.clientY-r.top)];dv.classList.remove("commenting");$("cm").setAttribute("aria-pressed","false");$("cn").focus()};
$("cs").onclick=run(function(){if(!pin)throw new Error("Tap Comment, then the spot on the screen.");var c=need().comment(pin[0],pin[1],$("cn").value);var m=document.createElement("span");m.className="pin";m.textContent=P.comments().length;m.style.left=pin[0]+"px";m.style.top=pin[1]+"px";dv.appendChild(m);var li=document.createElement("li");li.textContent=c.note+" (after "+c.steps+" steps)";$("cl").appendChild(li);$("cn").value="";pin=null});
$("cx").onclick=run(function(){down("comments.json",need().commentsFile())});
</script></body></html>
`;
}

/** Puts the frame page at index.html and the app's own entry at app.html (its asset paths are absolute, so it stays at the site root). */
export function wrapBuild(buildDir: string, name: string): PreviewFile[] {
  const files = collectFiles(buildDir).filter((f) => f.path !== "index.html");
  const entry = join(buildDir, "index.html");
  if (!existsSync(entry)) throw new Error("The web build has no index.html. Run `npx expo export --platform web` and check it works.");
  files.push({ path: "app.html", bytes: new Uint8Array(readFileSync(entry)), contentType: typeOf("x.html") });
  files.push({ path: "index.html", bytes: new TextEncoder().encode(framePage(name)), contentType: typeOf("x.html") });
  return files;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Publishes to here.now anonymously: create, upload, finalize. Refreshes expired upload URLs and waits out 429s. */
export async function publishToHereNow(files: PreviewFile[], o: PreviewOpts = {}): Promise<PreviewResult> {
  const f = o.fetch ?? fetch, sleep = o.sleep ?? realSleep, max = o.maxRetries ?? 3;
  refuseSecrets(files);
  const blocked = files.find((x) => blockedPath(x.path));
  if (blocked) throw new Error(`Refusing to upload ${blocked.path}.`);
  const headers = { "content-type": "application/json", "X-HereNow-Client": CLIENT };

  /** One JSON call; on 429 waits retry_after seconds (or Retry-After) and tries again, up to `max` times. */
  const call = async (url: string, body: unknown, what: string): Promise<any> => {
    for (let attempt = 0; ; attempt++) {
      const r = await f(url, { method: "POST", headers, body: JSON.stringify(body) });
      if (r.status === 429 && attempt < max) {
        let j: any = {}; try { j = await r.json(); } catch {}
        const secs = Number(j.retry_after ?? r.headers.get("retry-after") ?? 5);
        await sleep((Number.isFinite(secs) && secs > 0 ? Math.min(secs, 120) : 5) * 1000);
        continue;
      }
      let j: any = {}; try { j = await r.json(); } catch {}
      if (!r.ok) throw new Error(r.status === 429 ? `here.now is rate limiting this publish (${what}). Wait ${j.retry_after ?? "a few"} seconds and run again.` : `here.now ${what} failed (${r.status}): ${j.message ?? j.error ?? "no details"}`);
      return j;
    }
  };

  const created = await call(`${API}/publish`, { files: files.map((x) => ({ path: x.path, size: x.bytes.length, contentType: x.contentType })) }, "create");
  const slug: string = created.slug;
  let targets: { path: string; url: string; headers?: Record<string, string> }[] = created.upload.uploads;
  const byPath = new Map(files.map((x) => [x.path, x]));

  const putAll = async (list: typeof targets): Promise<typeof targets> => {
    const expired: typeof targets = [];
    for (const t of list) {
      const file = byPath.get(t.path); if (!file) continue;
      const r = await f(t.url, { method: "PUT", headers: { "content-type": file.contentType, ...(t.headers ?? {}) }, body: file.bytes as BodyInit });
      if (r.status === 403 || r.status === 401 || r.status === 400) expired.push(t);
      else if (!r.ok) throw new Error(`Upload of ${t.path} failed (${r.status}).`);
    }
    return expired;
  };
  let pending = await putAll(targets);
  for (let i = 0; pending.length && i < 2; i++) {
    const fresh = await call(`${API}/publish/${slug}/uploads/refresh`, { claimToken: created.claimToken }, "refresh upload URLs");
    const want = new Set(pending.map((p) => p.path));
    targets = (fresh.upload.uploads as typeof targets).filter((t) => want.has(t.path));
    pending = await putAll(targets);
  }
  if (pending.length) throw new Error(`Could not upload ${pending.length} file(s), e.g. ${pending[0].path}. Check that *.r2.cloudflarestorage.com is reachable, then run again.`);

  const done = await call(`${API}/publish/${slug}/finalize`, { versionId: created.upload.versionId }, "finalize");
  const warnings: string[] = (done.warnings ?? []).map((w: unknown) => (typeof w === "string" ? w : JSON.stringify(w)));
  return { url: done.siteUrl ?? created.siteUrl, claimUrl: created.claimUrl ?? null, expiresAt: created.expiresAt ?? null, files: files.length, warnings };
}

function build(root: string, out: string): Promise<void> {
  rmSync(out, { recursive: true, force: true }); mkdirSync(join(root, ".shipvo"), { recursive: true });
  return new Promise((resolve, reject) => {
    const p = spawn("npx", ["expo", "export", "--platform", "web", "--clear", "--output-dir", out], { cwd: root, env: { ...process.env, PN_SIM: "1" }, stdio: ["ignore", "ignore", "inherit"] });
    p.on("error", reject);
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`The web build failed (exit ${c}). Run \`npx expo export --platform web\` to see why.`))));
  });
}

export const NOTICE = "This link is public: anyone who has it can open the preview. It expires in 24 hours unless you open the claim link and sign in to here.now, which keeps it.";

/** Builds, wraps and publishes. Used by the CLI and by the MCP `publish_preview` tool (through `shipvo preview --json`). */
export async function runPreview(root: string, o: PreviewOpts & { skipBuild?: boolean; buildDir?: string } = {}): Promise<PreviewResult> {
  const cfg = loadConfig(root);
  const provider = cfg.preview ?? "here.now";
  if (provider === "control-plane") throw new Error('shipvo.json sets "preview": "control-plane". That provider is not built yet. Remove the setting or use "here.now".');
  if (provider !== "here.now") throw new Error(`shipvo.json: "preview" must be "here.now" or "control-plane", not "${provider}".`);
  const dir = o.buildDir ?? join(root, ".shipvo", "preview-build");
  if (!o.skipBuild) await build(root, dir);
  return publishToHereNow(wrapBuild(dir, cfg.name), o);
}

export async function preview(argv: string[]) {
  const a = parse(argv); const json = a.json === "true";
  if (!json) console.error("Building the web app with the simulated device…");
  const r = await runPreview(process.cwd(), { skipBuild: a["skip-build"] === "true" });
  if (json) { console.log(JSON.stringify({ url: r.url, claimUrl: r.claimUrl, expiresAt: r.expiresAt, files: r.files, warnings: r.warnings, public: true, notice: NOTICE })); return; }
  console.log(`Preview: ${r.url}`);
  if (r.claimUrl) console.log(`Keep it (claim link): ${r.claimUrl}`);
  if (r.expiresAt) console.log(`Expires: ${r.expiresAt}`);
  console.log(NOTICE);
  for (const w of r.warnings) console.log(`Warning from here.now: ${w}`);
}
