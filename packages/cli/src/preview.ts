// `shipvo preview`: build the web artifact with the simulated device, wrap it in a phone-sized frame page
// and publish it to here.now with no account. The link is public and lasts 24 hours unless claimed.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep, extname } from "node:path";
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

/** The page people open: the app in a phone-sized frame with a device and theme switcher. */
export function framePage(name: string): string {
  const title = name.replace(/[<>&"']/g, "");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title} preview</title>
<style>
:root{color-scheme:light}body.dark{color-scheme:dark}
html,body{margin:0;height:100%;font:14px system-ui,sans-serif;background:#e8eaed;color:#111}
body.dark{background:#15171a;color:#eee}
.bar{display:flex;gap:8px;justify-content:center;align-items:center;padding:10px;flex-wrap:wrap}
.bar button{font:inherit;padding:6px 12px;border:1px solid #888;border-radius:8px;background:transparent;color:inherit;cursor:pointer}
.bar button[aria-pressed=true]{background:#2563eb;border-color:#2563eb;color:#fff}
.stage{display:flex;justify-content:center;padding:0 10px 20px}
iframe{border:0;background:#fff;border-radius:28px;box-shadow:0 8px 30px #0005;width:360px;height:760px;max-width:100%}
.note{text-align:center;opacity:.7;padding:0 12px 16px}
@media (max-width:500px){.bar,.note{display:none}.stage{padding:0}iframe{width:100vw!important;height:100vh!important;height:100dvh!important;border-radius:0;box-shadow:none}}
</style></head><body>
<div class="bar" role="toolbar" aria-label="Preview options">
<button data-device="phone" aria-pressed="true">Phone</button><button data-device="iphone" aria-pressed="false">iPhone</button><button data-device="tablet" aria-pressed="false">Tablet</button>
<button id="theme" aria-pressed="false">Dark</button></div>
<div class="stage"><iframe id="app" src="app.html" title="${title}"></iframe></div>
<p class="note">${title}: simulated device, public preview. System sheets such as permissions and payments are simulated.</p>
<script>
var S={phone:[360,760],iphone:[390,844],tablet:[820,1180]},f=document.getElementById("app");
document.querySelectorAll("[data-device]").forEach(function(b){b.onclick=function(){var s=S[b.dataset.device];f.style.width=s[0]+"px";f.style.height=s[1]+"px";document.querySelectorAll("[data-device]").forEach(function(o){o.setAttribute("aria-pressed",o===b)})}});
var t=document.getElementById("theme");t.onclick=function(){var d=!document.body.classList.contains("dark");document.body.classList.toggle("dark",d);t.setAttribute("aria-pressed",d);t.textContent=d?"Light":"Dark";f.style.colorScheme=d?"dark":"light"};
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
