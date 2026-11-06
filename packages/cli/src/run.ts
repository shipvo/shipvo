// `shipvo run android|ios`: build the web export with the simulated device, serve it on a local port and
// open a phone frame page in the default browser. No browser automation. `--native` runs `npx expo run:<platform>`.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join, extname, normalize, resolve, sep } from "node:path";
import { loadConfig } from "./config.js";
import { AGENT_PATH, hostAllowed, isAgentRole, isLoopback, originAllowed, tokenMatches, type AgentRole, type RunInfo } from "./run-protocol.js";
import { bridgeScript } from "./run-bridge.js";
import { NET_PATH, createNetProxy, loadProfiles, netClientSource, type NetRecord } from "./run-net.js";
import { acceptWebSocket, type Peer } from "./run-ws.js";
import { qrMatrix, qrToTerminal } from "./qr.js";
import { spawnBin } from "./spawn-bin.js";
import { portFree, rebuildInto } from "./sim.js";

export type Platform = "android" | "ios";
export type RunOptions = { platform: Platform; open: boolean; port?: number; native: boolean; lan: boolean };

export const RUN_USAGE = `Usage: shipvo run android|ios [options]

Options:
  --no-open     do not open the browser
  --port <n>    serve on this port (default: a free port)
  --native      run on a real emulator or simulator with \`npx expo run:<platform>\`

Example: shipvo run android`;

/** True when this project has no earlier web build, so Metro starts with an empty cache. */
export const isFirstBuild = (root: string): boolean => !existsSync(join(root, "sim-dist"));

/** Parses `run` arguments. Throws a plain message for anything it does not know. */
export function parseRunArgs(argv: string[]): RunOptions {
  let platform: Platform | undefined; let open = true; let port: number | undefined; let native = false; let lan = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "android" || a === "ios") platform = a;
    else if (a === "--no-open") open = false;
    else if (a === "--native") native = true;
    else if (a === "--lan") lan = true;
    else if (a === "--port") {
      const v = argv[++i];
      if (!v || !/^\d+$/.test(v) || Number(v) > 65535) throw new Error(`--port needs a number from 0 to 65535, got "${v ?? ""}".`);
      port = Number(v);
    } else throw new Error(`Unknown argument "${a}". Usage: shipvo run android|ios [--no-open] [--port <n>] [--native] [--lan]`);
  }
  if (!platform) throw new Error("Say which phone: shipvo run android or shipvo run ios. Try: shipvo run android");
  if (lan && native) throw new Error("--lan serves the simulated phone; it cannot be combined with --native.");
  return { platform, open, port, native, lan };
}

/** The command `--native` runs. */
export const nativeCommand = (p: Platform): { cmd: string; args: string[] } => ({ cmd: "npx", args: ["expo", `run:${p}`] });

export const FRAMES = {
  android: { width: 412, height: 915, radius: 36, label: "Android", sheet: { title: "Allow access?", allow: "While using the app", deny: "Don't allow" } },
  ios: { width: 393, height: 852, radius: 55, label: "iOS", sheet: { title: "Would Like to Access", allow: "Allow While Using App", deny: "Don't Allow" } },
} as const;

export type RenderFrame = ((o: { skin: "android" | "ios"; dark?: boolean; status?: object; screen?: string; lumi?: boolean; guide?: boolean }) => { width: number; height: number; outerWidth: number; outerHeight: number; html: string; css: string }) & {
  /** Script that keeps the status bar live from the app's `pn:status` events. Absent in older @shipvo/sim. */
  statusScript?: (iframeId?: string, skin?: string) => string;
};

/** Loads the frame renderer from @shipvo/sim: the app's install first, then the one next to this CLI. */
export async function loadFrameRenderer(bases: string[] = [process.cwd() + "/package.json", import.meta.url]): Promise<RenderFrame> {
  let file: string | undefined;
  for (const base of bases) {
    try { file = createRequire(base).resolve("@shipvo/sim/frame.mjs"); break; } catch {}
  }
  if (!file) throw new Error("@shipvo/sim is not installed in this app. Run `npm i -D @shipvo/sim` (or use your package manager).");
  const mod = await import(pathToFileURL(file).href);
  const render: RenderFrame = (o) => mod.renderFrame(o);
  if (typeof mod.statusClientScript === "function") render.statusScript = mod.statusClientScript;
  return render;
}

/** The page that shows the app in an Android or iOS frame at its real logical size, scaled to fit the window. The phone body comes from @shipvo/sim's renderFrame. */
export function runFramePage(platform: Platform, name: string, render: RenderFrame, dark = false, token?: string): string {
  const f = FRAMES[platform];
  const title = name.replace(/[<>&"']/g, "");
  const sheet = `<div class="sheet" id="sheet" role="dialog" aria-label="${f.label} system sheet" data-part="system-sheet"><div class="box"><p>${f.sheet.title}</p><button type="button" data-act="allow">${f.sheet.allow}</button><button type="button" data-act="deny">${f.sheet.deny}</button></div></div>`;
  const frame = render({ skin: platform, dark, guide: true, screen: `<iframe id="app" src="/app/" title="${title}"></iframe>${sheet}` });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} on ${f.label} (simulated)</title>
<style>
html,body{margin:0;height:100%;overflow:hidden;background:${dark ? "#15171a" : "#e8eaed"};font:14px system-ui,sans-serif}
#fit{position:absolute;left:50%;top:50%;transform-origin:center;touch-action:manipulation}
${frame.css}
.sheet{position:absolute;inset:0;background:#0007;display:none;align-items:${platform === "ios" ? "center" : "flex-end"};justify-content:center;z-index:5}
.sheet.open{display:flex}
.sheet .box{background:#fff;color:#111;width:${platform === "ios" ? "270px" : "100%"};box-sizing:border-box;padding:20px;border-radius:${platform === "ios" ? "14px" : "28px 28px 0 0"};text-align:center}
.sheet button{display:block;width:100%;margin-top:8px;padding:10px;border:0;border-radius:${platform === "ios" ? "8px" : "20px"};background:#eee;font:inherit;cursor:pointer}
.sheetbtn{position:fixed;right:12px;top:10px;padding:3px 10px;border-radius:12px;border:0;background:#111;color:#fff;font-size:12px;cursor:pointer}
.tag{position:fixed;left:12px;top:10px;padding:3px 10px;border-radius:12px;background:#111;color:#fff;font-size:12px}
</style></head><body>
<div class="tag" role="status">Simulated ${f.label} (${f.width}x${f.height}). The app's web build on the simulated device.</div>
<button class="sheetbtn" id="sheetbtn" type="button">Show ${f.label} system sheet</button>
<div id="fit"><div id="phone" data-platform="${platform}">${frame.html}</div></div>
<script>
var sh=document.getElementById("sheet");
function sheet(on){sh.classList.toggle("open",on)}
document.getElementById("sheetbtn").onclick=function(){sheet(!sh.classList.contains("open"))};
sh.onclick=function(e){if(e.target===sh||e.target.getAttribute("data-act"))sheet(false)};
addEventListener("message",function(e){var d=e.data;if(d&&d.type==="shipvo:system-sheet")sheet(d.open!==false)});
function fit(){var s=Math.min(1,(innerWidth-24)/${frame.outerWidth},(innerHeight-60)/${frame.outerHeight});var e=document.getElementById("fit");e.style.transform="translate(-50%,-50%) scale("+s+")";e.style.width="${frame.outerWidth}px";e.style.height="${frame.outerHeight}px"}
addEventListener("resize",fit);fit();
</script>${render.statusScript ? `<script>${render.statusScript("app", platform).replace(/<\/script/gi, "<\\/script")}</script>` : ""}${token ? `<script src="/__shipvo/bridge.js" data-token="${token}"></script>` : ""}</body></html>`;
}

/** True for a phone or tablet browser, by user agent. */
export const isMobileUserAgent = (ua: string | undefined): boolean => /Android|iPhone|iPad|iPod|Mobile/i.test(ua ?? "");

/** The page for a real phone's browser: the app fills the screen, no phone frame. */
export function runBarePage(name: string, dark = false): string {
  const title = name.replace(/[<>&"']/g, "");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title}</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:${dark ? "#15171a" : "#fff"}}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style></head><body>
<iframe id="app" src="/app/" title="${title}" data-part="bare-app"></iframe>
</body></html>`;
}

/** The first private IPv4 address of this machine (or any non-internal one), or undefined. */
export function lanAddress(ifaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): string | undefined {
  const all = Object.values(ifaces).flatMap((l) => l ?? []).filter((i) => i.family === "IPv4" && !i.internal).map((i) => i.address);
  return all.find((a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)) ?? all[0];
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon",
  ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm",
};

/** Adds `.shipvo/` to `<dir>/.gitignore` when it is not already ignored. */
export function ensureShipvoIgnored(dir: string): void {
  const path = join(dir, ".gitignore");
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (/^\/?\.shipvo\/?\s*$/m.test(text)) return;
  appendFileSync(path, (text && !text.endsWith("\n") ? "\n" : "") + ".shipvo/\n");
}

/**
 * Serves the frame page at `/` and the web export at `/app/` (and its absolute asset paths at `/`).
 * Port 0 picks a free port. Resolves once listening.
 * The agent channel is a WebSocket at `/__shipvo/agent?role=screen|driver&token=...`, loopback only. It relays JSON
 * messages between the `screen` and the `driver`. With `projectDir`, `.shipvo/run.json` describes the session while it runs.
 */
export async function startRunServer(opts: { dir: string; platform: Platform; name: string; appId?: string; port?: number; projectDir?: string; render?: RenderFrame; lan?: { host: string }; onNet?: (r: NetRecord) => void; fetchImpl?: typeof fetch }): Promise<{ server: Server; port: number; token: string; lanToken?: string; netLog: NetRecord[]; close: () => Promise<void> }> {
  const root = resolve(opts.dir);
  const token = randomBytes(24).toString("hex");
  // The page gets its own credential: random, in memory only, never written to run.json, and valid for `screen` only.
  const pageToken = randomBytes(24).toString("hex");
  const render = opts.render ?? await loadFrameRenderer();
  const pages = { light: runFramePage(opts.platform, opts.name, render, false, pageToken), dark: runFramePage(opts.platform, opts.name, render, true, pageToken) };
  const bridge = bridgeScript();
  // With --lan every request needs this token, in `?t=` or in the cookie the first valid request sets.
  const lanToken = opts.lan ? randomBytes(16).toString("hex") : undefined;
  let boundPort = -1; // set once the server listens; Host and Origin must match it
  // App requests to other origins go through /__shipvo/net, so the browser applies no CORS (see run-net.ts). Only the page's token opens it.
  const net = createNetProxy({ tokens: [pageToken, token], port: () => boundPort, profiles: await loadProfiles(), onRecord: opts.onNet, fetchImpl: opts.fetchImpl });
  const netSnippet = `<script>(${netClientSource()})(window,{token:${JSON.stringify(pageToken)},session:(function(){try{var k="shipvo_net_session";return sessionStorage.getItem(k)||(sessionStorage.setItem(k,crypto.randomUUID()),sessionStorage.getItem(k))}catch(e){return "tab"}})(),profile:function(){return window.__pnNet?window.__pnNet.profile():"online"},online:function(){return window.__pnNet?window.__pnNet.online():true},log:function(d){if(window.__pnNet)window.__pnNet.log(d)}})</script>`;
  const server = createServer((req, res) => {
    if (!hostAllowed(req.headers.host, boundPort) && !(opts.lan && req.headers.host === `${opts.lan.host}:${boundPort}`)) { res.writeHead(403); return void res.end("Forbidden"); }
    if (lanToken) {
      const given = new URL(req.url ?? "/", "http://x").searchParams.get("t");
      const cookie = /(?:^|;\s*)shipvo_t=([0-9a-f]+)/.exec(req.headers.cookie ?? "")?.[1] ?? null;
      if (tokenMatches(given, lanToken)) res.setHeader("set-cookie", `shipvo_t=${lanToken}; Path=/; HttpOnly; SameSite=Lax`);
      else if (!tokenMatches(cookie, lanToken)) { res.writeHead(403); return void res.end("Forbidden: open the address shipvo run printed, it has the token."); }
    }
    let path: string;
    try { path = decodeURIComponent((req.url ?? "/").split("?")[0]); }
    catch { res.writeHead(400); return void res.end("Bad request"); }
    if (path === "/app") { res.writeHead(302, { location: "/app/" }); return void res.end(); }
    if (path === "/" || path === "/index.html") {
      const dark = new URL(req.url ?? "/", "http://x").searchParams.get("dark") === "1";
      const bare = isMobileUserAgent(req.headers["user-agent"]);
      res.writeHead(200, { "content-type": TYPES[".html"], vary: "user-agent" }); return void res.end(bare ? runBarePage(opts.name, dark) : dark ? pages.dark : pages.light);
    }
    if (path === NET_PATH) return void net.handle(req, res);
    if (path === "/__shipvo/bridge.js") { res.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store" }); return void res.end(bridge); }
    let rel = path.startsWith("/app/") ? path.slice(4) : path;
    if (rel.endsWith("/")) rel += "index.html";
    const file = normalize(join(root, rel));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); return void res.end("Forbidden"); }
    let target = file;
    if (!existsSync(target) || !statSync(target).isFile()) {
      // A client-side route inside the frame (for example a reload on /app/settings): serve the app shell.
      const spa = path.startsWith("/app/") && !extname(path) ? join(root, "index.html") : "";
      if (!spa || !existsSync(spa)) { res.writeHead(404); return void res.end("Not found"); }
      target = spa;
    }
    const type = TYPES[extname(target).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    if (extname(target).toLowerCase() === ".html") {
      const html = readFileSync(target, "utf8"); // first script in the page, so it wraps fetch before the app's code runs
      // A real phone (not loopback) cannot use the route, which only serves the local page: leave its requests direct.
      if (isLoopback(req.socket.remoteAddress) && /<head[^>]*>/i.test(html)) return void res.end(html.replace(/<head[^>]*>/i, (m) => m + netSnippet));
    }
    res.end(readFileSync(target));
  });
  const peers: Partial<Record<AgentRole, Peer>> = {};
  server.on("upgrade", (req, socket) => {
    const refuse = (line: string) => socket.end(`HTTP/1.1 ${line}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== AGENT_PATH) return refuse("404 Not Found");
    if (!isLoopback(req.socket.remoteAddress)) return refuse("403 Forbidden");
    if (!hostAllowed(req.headers.host, boundPort) || !originAllowed(req.headers.origin, boundPort)) return refuse("403 Forbidden");
    const given = url.searchParams.get("token");
    const role = url.searchParams.get("role");
    const ok = tokenMatches(given, token) || (role === "screen" && tokenMatches(given, pageToken));
    if (!ok) return refuse("401 Unauthorized");
    if (!isAgentRole(role)) return refuse("400 Bad Request");
    const other: AgentRole = role === "screen" ? "driver" : "screen";
    const peer = acceptWebSocket(req, socket, (text) => {
      try { JSON.parse(text); } catch { return; }
      peers[other]?.send(text);
    }, () => { if (peers[role] === peer) delete peers[role]; });
    if (!peer) return;
    const old = peers[role]; // a reloaded tab or a restarted agent replaces the old connection
    peers[role] = peer;
    old?.close();
  });
  const infoPath = opts.projectDir ? join(resolve(opts.projectDir), ".shipvo", "run.json") : undefined;
  const cleanup = () => { if (infoPath) rmSync(infoPath, { force: true }); };
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(opts.port ?? 0, opts.lan ? "0.0.0.0" : "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      boundPort = port;
      if (infoPath) {
        const info: RunInfo = { port, platform: opts.platform, app: opts.appId ?? opts.name, token, pid: process.pid };
        mkdirSync(join(infoPath, ".."), { recursive: true });
        writeFileSync(infoPath, JSON.stringify(info, null, 2) + "\n", { mode: 0o600 });
      }
      ok({ server, port, token, lanToken, netLog: net.log, close: () => new Promise<void>((r) => { cleanup(); for (const p of Object.values(peers)) p?.close(); server.close(() => r()); server.closeAllConnections?.(); }) });
    });
  });
}

/** Names the module or file a web build failed on, from the build's error output. */
export function describeWebBuildFailure(output: string): string {
  const m = /Unable to resolve module ['"]?([^'"\s]+)['"]?(?: from ['"]?([^'":\s]+))?/.exec(output)
    ?? /Module not found: (?:Error: )?Can't resolve '([^']+)'(?: in '([^']+)')?/.exec(output)
    ?? /Cannot find module ['"]([^'"]+)['"]/.exec(output);
  if (m) return `The app cannot build for web: ${m[1]} fails to resolve${m[2] ? ` (from ${m[2]})` : ""}. Fix or stub that module for web, or use \`shipvo run <platform> --native\`.`;
  const f = /(?:SyntaxError|Error)[^\n]*\n?[^\n]*?(\S+\.(?:tsx?|jsx?|json))/.exec(output) ?? /(\S+\.(?:tsx?|jsx?|json))/.exec(output);
  const last = output.trim().split("\n").slice(-1)[0] ?? "";
  return `The app cannot build for web${f ? ` (in ${f[1]})` : ""}: ${last || "see the build output above"}. Use \`shipvo run <platform> --native\` to run it natively.`;
}

/** Builds the web export with `rebuildInto` from sim.ts (the same build as `shipvo sim`) into `<root>/sim-dist`. */
export async function buildWeb(root: string, command?: string): Promise<void> {
  try { await rebuildInto({ root, command, echo: true }); }
  catch (e) { throw new Error(describeWebBuildFailure((e as { output?: string }).output ?? (e as Error).message)); }
}

export function openBrowser(url: string) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  const p = spawn(cmd, args, { stdio: "ignore", detached: true });
  p.on("error", () => console.error(`Could not open a browser. Open ${url} yourself.`));
  p.unref();
}

/** Returns the exit code. */
export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) { console.log(RUN_USAGE); return 0; }
  let o: RunOptions;
  try { o = parseRunArgs(argv); } catch (e) { console.error((e as Error).message); return 2; }
  if (o.native) {
    const { cmd, args } = nativeCommand(o.platform);
    console.error(`Running natively: ${cmd} ${args.join(" ")} (not the simulated device)`);
    const call = spawnBin(cmd, args);
    return spawnSync(call.command, call.args, { stdio: "inherit", shell: call.shell }).status ?? 1;
  }
  let name: string, appId: string;
  try { const c = loadConfig(); name = c.name; appId = c.appId; } catch (e) { console.error((e as Error).message); return 1; }
  if (o.port !== undefined && o.port !== 0 && !(await portFree(o.port))) { console.error(`Port ${o.port} is in use. Pass another --port <n>.`); return 1; }
  const out = join(process.cwd(), "sim-dist");
  if (isFirstBuild(process.cwd())) console.error("First build, this can take a minute.");
  console.error(`Building ${name} for web with the simulated device…`);
  try { await buildWeb(process.cwd()); } catch (e) { console.error((e as Error).message); return 1; }
  try { ensureShipvoIgnored(process.cwd()); } catch { /* read-only project: the session still works */ }
  let lan: { host: string } | undefined;
  if (o.lan) {
    const host = lanAddress();
    if (!host) { console.error("--lan needs a network address and this computer has none. Connect to Wi-Fi and try again."); return 1; }
    lan = { host };
  }
  const s = await startRunServer({ dir: out, platform: o.platform, name, appId, port: o.port, projectDir: process.cwd(), lan });
  const url = `http://127.0.0.1:${s.port}/${s.lanToken ? `?t=${s.lanToken}` : ""}`;
  if (lan && s.lanToken) {
    const lanUrl = `http://${lan.host}:${s.port}/?t=${s.lanToken}`;
    console.error(`\nOpen this on your phone (same Wi-Fi):\n${lanUrl}\n\n${qrToTerminal(qrMatrix(lanUrl))}\n`);
    console.error("Warning: anyone on this network who has this address can open the page. The token in it is the only lock. Press Ctrl+C to stop sharing.");
  }
  console.error(`Simulated ${FRAMES[o.platform].label} phone at ${url}  (Ctrl+C to stop)`);
  if (o.open) openBrowser(url);
  await new Promise<void>((done) => { for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, done); });
  await s.close();
  return 0;
}
