// `shipvo lumi`: the app on Shipvo Phone in your browser, with a sidebar for Lumi (live feed, findings, coverage, command box).
// Commands are plain text matched by rules. There is no AI call. `Lumi` is the engine and only needs a `Driver`, so tests run it
// against a fake app. `lumi()` wires it to the simulator and a small local web server.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { args as parse, loadConfig } from "./config.js";
import { elements, fieldElements, signature, describeStep, walk, startSim, simDriver, type Driver, type Finding, type Skin, type Step, type WalkOptions } from "./explore.js";
import { writeTests } from "./explore-tests.js";
import { portFree } from "./sim.js";
import { loadFrameRenderer, openBrowser } from "./run.js";

export type Mood = "idle" | "working" | "happy" | "worried";
export type Command =
  | { kind: "test-all" } | { kind: "test-flow"; flow: string } | { kind: "bad-input"; flow: string }
  | { kind: "stop" } | { kind: "replay"; n: number } | { kind: "save"; n: number } | { kind: "help" } | { kind: "unknown" };

/** Reads a line of text as a command. No AI: a few patterns, case and spacing ignored. */
export function parseCommand(text: string): Command {
  const t = text.trim().replace(/\s+/g, " ").replace(/[.!]+$/, "");
  let m: RegExpExecArray | null;
  if (/^(help|\?|commands)$/i.test(t)) return { kind: "help" };
  if (/^(stop|cancel|halt)$/i.test(t)) return { kind: "stop" };
  if ((m = /^save (?:bug|finding) #?(\d+)(?: as (?:a )?test)?$/i.exec(t))) return { kind: "save", n: Number(m[1]) };
  if ((m = /^replay (?:bug|finding) #?(\d+)$/i.exec(t))) return { kind: "replay", n: Number(m[1]) };
  if (/^test (?:my |the )?(?:whole )?app$/i.test(t) || /^test$/i.test(t)) return { kind: "test-all" };
  if ((m = /^try (.+?) with bad (?:input|data|values)$/i.exec(t))) return { kind: "bad-input", flow: m[1]!.replace(/^(?:the|my) /i, "").replace(/ flow$/i, "") };
  if ((m = /^test (.+)$/i.exec(t))) return { kind: "test-flow", flow: m[1]!.replace(/^(?:the|my) /i, "").replace(/ flow$/i, "") };
  return { kind: "unknown" };
}

export const COMMAND_LIST = ["test my app", "test <flow>", "try <flow> with bad input", "stop", "replay bug <n>", "save bug <n>", "help"];
export type FeedItem = { at: string; text: string; kind: "step" | "info" | "bug" };
export type State = {
  mood: Mood; running: boolean; label: string; feed: FeedItem[];
  findings: { n: number; kind: string; message: string; steps: string[] }[];
  coverage: { screens: number; controlsSeen: number; controlsTried: number };
};
type Known = { n: number; key: string; finding: Finding };

export type LumiOptions = { routes?: string[]; maxDepth?: number; maxSteps?: number; seed?: number; skin?: Skin; app?: string; settleMs?: number; walkDelayMs?: number; testsDir?: string };

export class Lumi {
  private feed: FeedItem[] = []; private known: Known[] = [];
  private screens = new Set<string>(); private seen = new Set<string>(); private tried = new Set<string>();
  private mood: Mood = "idle"; private running = false; private label = ""; private stopFlag = false;
  private listeners = new Set<(s: State) => void>(); private job: Promise<void> = Promise.resolve();
  constructor(private driver: Driver, private o: LumiOptions = {}) {}

  subscribe(fn: (s: State) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  state(): State {
    return {
      mood: this.mood, running: this.running, label: this.label, feed: this.feed.slice(-200),
      findings: this.known.map((k) => ({ n: k.n, kind: k.finding.kind, message: k.finding.message, steps: k.finding.steps.map(describeStep) })),
      coverage: { screens: this.screens.size, controlsSeen: this.seen.size, controlsTried: this.tried.size },
    };
  }
  /** Resolves when the current run or replay has ended. */
  idle(): Promise<void> { return this.job; }
  private emit() { const s = this.state(); for (const f of this.listeners) f(s); }
  private say(text: string, kind: FeedItem["kind"] = "info") { this.feed.push({ at: new Date().toISOString(), text, kind }); if (this.feed.length > 500) this.feed.splice(0, this.feed.length - 500); this.emit(); }

  /** Names you can use after `test` and `try`: configured routes, then the controls on the start screen. */
  async flows(): Promise<string[]> {
    const names = (this.o.routes ?? []).map(routeName).filter(Boolean);
    try { const r = await this.driver.open(); if (r.ok && r.screen) for (const e of elements(r.screen)) if (e.name) names.push(e.name); } catch { /* the list is only a hint */ }
    return [...new Set(names)];
  }
  private async resolve(flow: string): Promise<{ label: string; paths: Step[][] } | { error: string }> {
    const f = flow.toLowerCase();
    const routes = (this.o.routes ?? []).filter((r) => routeName(r));
    const hit = routes.find((r) => routeName(r) === f) ?? routes.find((r) => routeName(r).includes(f));
    if (hit) return { label: routeName(hit), paths: [[{ action: "open" }, { action: "open_url", url: hit }]] };
    const r = await this.driver.open();
    const els = r.ok && r.screen ? elements(r.screen).filter((e) => e.name) : [];
    const c = els.find((e) => e.name.toLowerCase() === f) ?? els.find((e) => e.name.toLowerCase().includes(f));
    if (c) return { label: c.name, paths: [[{ action: "open" }, { action: "tap", role: c.role, name: c.name, nth: c.nth }]] };
    const known = await this.flows();
    return { error: `I do not know a flow called "${flow}".${known.length ? ` Try one of: ${known.join(", ")}.` : ""}` };
  }

  /** Handles one line from the command box. Returns the short reply at once; a run goes on in the background (see `idle`). */
  async command(text: string): Promise<string> {
    const c = parseCommand(text);
    if (c.kind === "help") return `Commands: ${COMMAND_LIST.join("; ")}.`;
    if (c.kind === "unknown") return `I do not know that one. Commands: ${COMMAND_LIST.join("; ")}.`;
    if (c.kind === "stop") {
      if (!this.running) return "Nothing is running.";
      this.stopFlag = true; this.say("Stopping after this action."); return "Stopping after this action.";
    }
    if (c.kind === "save") {
      const k = this.known[c.n - 1];
      if (!k) return this.known.length ? `There is no bug ${c.n}. Bugs so far: 1 to ${this.known.length}.` : "There are no bugs to save yet. Say \"test my app\" first.";
      const dir = this.o.testsDir ?? "lumi-tests";
      const { files, skipped } = writeTests([k.finding], dir, c.n);
      if (!files.length) return `Bug ${c.n} cannot be a test: ${skipped[0]?.reason ?? "no check for it"}. It is in the report.`;
      this.say(`Saved bug ${c.n} as a test: ${files[0]}`);
      return `Saved bug ${c.n} as ${files[0]}. Run it with npx vitest run ${files[0]}. It fails while the bug is there.`;
    }
    if (this.running) return "I am busy. Say stop first, or wait for the run to end.";
    if (c.kind === "replay") {
      const k = this.known[c.n - 1];
      if (!k) return this.known.length ? `There is no bug ${c.n}. Bugs so far: 1 to ${this.known.length}.` : "There are no bugs to replay yet. Say \"test my app\" first.";
      this.start(`replay bug ${c.n}`, () => this.replay(k));
      return `Replaying bug ${c.n}.`;
    }
    if (c.kind === "test-all") { this.start("test my app", () => this.run({ routes: this.o.routes })); return "Testing the whole app."; }
    const r = await this.resolve(c.flow);
    if ("error" in r) return r.error;
    const bad = c.kind === "bad-input";
    this.start(bad ? `${r.label} with bad input` : r.label, () => this.run({ startPaths: r.paths, ...(bad ? { input: "bad" as const } : {}) }));
    return bad ? `Trying ${r.label} with bad input.` : `Testing ${r.label}.`;
  }

  private start(label: string, fn: () => Promise<void>) {
    this.running = true; this.stopFlag = false; this.label = label; this.mood = "working"; this.say(`Starting: ${label}.`);
    this.job = fn().catch((e) => { this.say(`Stopped by an error: ${e instanceof Error ? e.message : String(e)}`, "bug"); this.mood = "worried"; })
      .finally(() => { this.running = false; this.label = ""; this.emit(); });
  }

  private async run(w: WalkOptions) {
    const before = this.known.length;
    const r = await walk(this.driver, {
      maxDepth: this.o.maxDepth, maxSteps: this.o.maxSteps, seed: this.o.seed, skin: this.o.skin, app: this.o.app, settleMs: this.o.settleMs, ...w,
      shouldStop: () => this.stopFlag,
      onEvent: (e) => {
        if (e.type === "step") {
          if (e.step.action === "tap" || e.step.action === "type") this.tried.add(`${e.step.role}|${e.step.name}`);
          this.say(e.text, "step");
        } else if (e.type === "screen") {
          this.screens.add(e.sig); for (const c of e.controls) this.seen.add(`${c.role}|${c.name}`); this.emit();
        } else {
          const key = `${e.finding.kind}|${e.finding.message}|${signature(e.finding.screen)}`;
          if (this.known.some((k) => k.key === key)) return;
          const n = this.known.push({ n: this.known.length + 1, key, finding: e.finding });
          this.say(`Bug ${n}: ${e.finding.message}`, "bug");
        }
      },
    });
    const found = this.known.length - before;
    this.mood = this.known.length ? "worried" : r.error || r.stoppedEarly ? "idle" : "happy";
    const why = r.stoppedEarly ? ` Stopped: ${r.stoppedEarly}.` : "";
    this.say(`Done. ${r.steps} action${r.steps === 1 ? "" : "s"}, ${r.screens} screen${r.screens === 1 ? "" : "s"}, ${found} new bug${found === 1 ? "" : "s"}.${why}${r.error ? ` Error: ${r.error}` : ""}`);
  }

  /** Does the steps of a bug again, one by one, and says whether the screen is the same as when it was found. */
  private async replay(k: Known) {
    let screen = ""; let ok = true;
    await this.driver.errors().catch(() => []);
    for (const s of k.finding.steps) {
      if (this.stopFlag) { this.mood = this.known.length ? "worried" : "idle"; this.say("Replay stopped."); return; }
      this.say(describeStep(s), "step");
      let r;
      if (s.action === "open") r = await this.driver.open();
      else if (s.action === "open_url") r = await this.driver.openUrl(s.url);
      else if (s.action === "back") r = await this.driver.back();
      else {
        const el = (s.action === "type" ? fieldElements(screen) : elements(screen)).find((e) => e.role === s.role && e.name === s.name && e.nth === s.nth);
        if (!el) { this.say(`Could not find ${s.role} "${s.name}" on this screen. The app may have changed since bug ${k.n}.`, "bug"); ok = false; break; }
        r = s.action === "type" ? await this.driver.type?.(el.ref, s.text, s.enter) ?? { ok: false, error: "this simulator cannot type" } : await this.driver.tap(el.ref);
      }
      if (r.screen != null) screen = r.screen;
      if (!r.ok && s.action !== "back") { this.say(`Action failed: ${r.error ?? "unknown"}`, "bug"); ok = false; break; }
      if (this.o.walkDelayMs) await new Promise((res) => setTimeout(res, this.o.walkDelayMs));
    }
    const errs = await this.driver.errors().catch(() => []);
    const same = ok && signature(screen) === signature(k.finding.screen);
    this.mood = same || errs.length ? "worried" : "happy";
    this.say(same ? `Bug ${k.n} is still there: the screen is the same as when I found it.${errs.length ? ` Errors: ${errs.join("; ")}` : ""}` : errs.length ? `Bug ${k.n}: the steps raised ${errs.length} error${errs.length === 1 ? "" : "s"}: ${errs.join("; ")}` : ok ? `Bug ${k.n} did not show up this time. The screen is different.` : `Could not replay bug ${k.n} to the end.`, same || errs.length ? "bug" : "info");
  }
}

/** "tide://cart" -> "cart", "/orders/open" -> "open". */
export function routeName(url: string): string {
  return (url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/).filter(Boolean).pop() ?? "").toLowerCase();
}

// ---- the page ----

const SIDEBAR = `<aside class="lm" aria-label="Lumi" data-part="sidebar">
<h1><span data-part="mood-label">Lumi</span></h1><p class="lm-now" data-part="now" role="status" aria-live="polite">Idle. Say "test my app".</p>
<section aria-labelledby="lm-h-feed"><h2 id="lm-h-feed">What Lumi is doing</h2><ol class="lm-feed" data-part="feed" aria-live="off"></ol></section>
<section aria-labelledby="lm-h-bugs"><h2 id="lm-h-bugs">Findings <span data-part="bug-count">0</span></h2><ol class="lm-bugs" data-part="findings"></ol></section>
<section aria-labelledby="lm-h-cov"><h2 id="lm-h-cov">Coverage</h2><dl class="lm-cov" data-part="coverage"><dt>Screens</dt><dd data-part="cov-screens">0</dd><dt>Controls tried</dt><dd data-part="cov-tried">0 of 0</dd></dl></section>
<form class="lm-cmd" data-part="command-form"><label for="lm-in">Tell Lumi what to do</label><div><input id="lm-in" data-part="command" autocomplete="off" placeholder="test my app" spellcheck="false"><button type="submit">Send</button></div><p class="lm-reply" data-part="reply" role="status"></p></form>
</aside>`;

const CSS = `:root{color-scheme:light dark;--bg:#eef1f4;--fg:#111820;--card:#fff;--line:#d3d9e0;--muted:#55606c;--accent:#1769aa;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#10151c;--fg:#eaf0f6;--card:#192029;--line:#2c3743;--muted:#9fb0c0;--accent:#7fc4f5;--bad:#ff9a8a}}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:14px system-ui,sans-serif}
.lm-page{display:flex;height:100%;gap:16px;padding:16px;box-sizing:border-box}.lm-stage{flex:1;min-width:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
.lm-stage .sf-content img{display:block;width:100%;height:100%;object-fit:contain;background:#fff}
.lm{flex:none;width:360px;display:flex;flex-direction:column;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;box-sizing:border-box;overflow:auto}
.lm h1{margin:0;font-size:18px}.lm h2{margin:0 0 4px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}.lm p{margin:0}.lm-now{color:var(--muted)}
.lm ol{margin:0;padding:0;list-style:none}.lm-feed{max-height:190px;overflow:auto;font-family:ui-monospace,monospace;font-size:12px}.lm-feed li{padding:2px 0;border-bottom:1px solid var(--line)}.lm-feed .bug,.lm-bugs{color:var(--bad)}
.lm-bugs{max-height:170px;overflow:auto}.lm-bugs li{display:flex;gap:6px;align-items:flex-start;padding:3px 0}.lm-bugs span{flex:1}.lm-bugs button{flex:none;font:inherit;font-size:12px;padding:2px 8px}
.lm-cov{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:0}.lm-cov dt{color:var(--muted)}.lm-cov dd{margin:0;font-weight:600}
.lm-cmd label{display:block;margin-bottom:4px;font-weight:600}.lm-cmd div{display:flex;gap:6px}.lm-cmd input{flex:1;min-width:0;font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
.lm-cmd button{font:inherit;padding:8px 14px;border:0;border-radius:8px;background:var(--accent);color:var(--bg);font-weight:600;cursor:pointer}.lm-reply{margin-top:6px;color:var(--muted);min-height:1.2em}
.lm button:focus-visible,.lm input:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
@media (max-width:900px){.lm-page{flex-direction:column;overflow:auto}.lm{width:auto}.lm-stage{flex:none;height:50vh}}`;

const CLIENT = `(function(){var $=function(p){return document.querySelector('[data-part="'+p+'"]')};
var phone=document.querySelector('[data-part="phone-body"]'),stage=document.querySelector(".lm-stage");
function fit(){var k=Math.min(1,(stage.clientWidth-8)/phone.offsetWidth,(stage.clientHeight-8)/phone.offsetHeight);phone.style.transform="scale("+k+")";phone.style.transformOrigin="center"}
addEventListener("resize",fit);if(window.ResizeObserver)new ResizeObserver(fit).observe(stage);fit();
var LABEL={idle:"Lumi",working:"Lumi is testing",happy:"Lumi is happy",worried:"Lumi found something"};
function li(t,c){var e=document.createElement("li");if(c)e.className=c;e.textContent=t;return e}
function render(s){
if(window.shipvoLumi)window.shipvoLumi.set(s.mood);
$("mood-label").textContent=LABEL[s.mood]||"Lumi";
var last=s.feed[s.feed.length-1];$("now").textContent=s.running?(s.label?"Working on: "+s.label+". ":"")+(last?last.text:""):(last?last.text:'Idle. Say "test my app".');
var f=$("feed");f.textContent="";s.feed.slice(-40).forEach(function(i){f.append(li(i.text,i.kind==="bug"?"bug":""))});f.scrollTop=f.scrollHeight;
var b=$("findings");b.textContent="";$("bug-count").textContent=s.findings.length;
s.findings.forEach(function(x){var e=document.createElement("li"),t=document.createElement("span");t.textContent="Bug "+x.n+": "+x.message;
var r=document.createElement("button");r.type="button";r.textContent="Replay";r.setAttribute("aria-label","Replay bug "+x.n);r.onclick=function(){send("replay bug "+x.n)};var v=document.createElement("button");v.type="button";v.textContent="Save as test";v.setAttribute("aria-label","Save bug "+x.n+" as a test");v.onclick=function(){send("save bug "+x.n)};e.append(t,r,v);b.append(e)});
$("cov-screens").textContent=s.coverage.screens;$("cov-tried").textContent=s.coverage.controlsTried+" of "+s.coverage.controlsSeen}
function send(t){fetch("/cmd",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:t})}).then(function(r){return r.json()}).then(function(j){$("reply").textContent=j.reply||j.error||""}).catch(function(){$("reply").textContent="Could not reach Lumi. Is shipvo lumi still running?"})}
$("command-form").onsubmit=function(e){e.preventDefault();var i=$("command"),v=i.value.trim();if(!v)return;i.value="";send(v)};
var state={running:false},es=new EventSource("/events");es.onmessage=function(e){state=JSON.parse(e.data);render(state)};
var img=document.querySelector('[data-part="screen"]');
function shot(){var n=new Image();n.onload=function(){img.src=n.src;next()};n.onerror=next;n.src="/shot?"+Date.now()}
function next(){setTimeout(shot,document.hidden?3000:state.running?700:2000)}
shot();
})();`;

/** The whole page: the phone frame with the live app picture in it, and the sidebar. */
export function lumiPage(frame: { html: string; css: string }, title: string): string {
  const safe = title.replace(/[<>&"']/g, "");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lumi: ${safe}</title><style>${frame.css}\n${CSS}</style></head>`
    + `<body><div class="lm-page"><main class="lm-stage">${frame.html}</main>${SIDEBAR}</div><script>${CLIENT.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}

// ---- the server ----

export type LumiServerOptions = { lumi: Lumi; page: string; shot: () => Promise<Buffer | null>; port: number };

/** Local server for the page. It only answers requests whose Host is this machine's address, and only commands from this page. */
export function startLumiServer(o: LumiServerOptions): Promise<Server> {
  const hosts = new Set([`localhost:${o.port}`, `127.0.0.1:${o.port}`, `[::1]:${o.port}`]);
  const body = async (req: IncomingMessage) => { let b = ""; for await (const c of req) { b += c; if (b.length > 10_000) throw new Error("too big"); } return b; };
  const server = createServer(async (req, res) => {
    const send = (code: number, data: string | Buffer, type = "application/json") => { res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(data); };
    try {
      if (!hosts.has(String(req.headers.host))) return send(403, '{"error":"forbidden"}');
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (req.method === "GET" && path === "/") return send(200, o.page, "text/html; charset=utf-8");
      if (req.method === "GET" && path === "/state") return send(200, JSON.stringify(o.lumi.state()));
      if (req.method === "GET" && path === "/shot") { const b = await o.shot().catch(() => null); return b ? send(200, b, "image/jpeg") : send(204, ""); }
      if (req.method === "GET" && path === "/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        let off = (): void => {};
        const push = (s: unknown) => { try { res.write(`data: ${JSON.stringify(s)}\n\n`); } catch { off(); } };
        push(o.lumi.state()); off = o.lumi.subscribe(push); req.on("close", off); res.on("close", off); return;
      }
      if (req.method === "POST" && path === "/cmd") {
        const origin = req.headers.origin; let oh: string | null = null; try { oh = origin ? new URL(origin).host : null; } catch { oh = "bad"; }
        if ((oh && oh !== req.headers.host) || !/^application\/json/i.test(String(req.headers["content-type"]))) return send(403, '{"error":"forbidden"}');
        const text = String((JSON.parse(await body(req)) as { text?: unknown }).text ?? "");
        return send(200, JSON.stringify({ reply: await o.lumi.command(text) }));
      }
      send(404, '{"error":"not found"}');
    } catch (e) { send(500, JSON.stringify({ error: e instanceof Error ? e.message : String(e) })); }
  });
  return new Promise((resolve, reject) => { server.once("error", reject); server.listen(o.port, "127.0.0.1", () => resolve(server)); });
}

const USAGE = "Usage: shipvo lumi [android|ios] [--port 4546] [--ui-port 4547] [--sim <url>] [--skip-build] [--no-open] [--max-steps 100] [--max-depth 3, at least 1] [--seed 1] [--tests-dir lumi-tests]";

/** Builds the app, opens it on Shipvo Phone in the browser with the Lumi sidebar. Runs until Ctrl-C. */
export async function lumi(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) { console.log(USAGE); return 0; }
  const a = parse(argv); const cfg = loadConfig();
  const skin = (argv.includes("ios") ? "ios" : "android") as Skin;
  const num = (k: string, d: number) => { if (a[k] === undefined) return d; const n = Number(a[k]); if (!Number.isInteger(n) || n < 0) throw new Error(`--${k} must be a whole number`); return n; };
  const uiPort = num("ui-port", 4547);
  if (!(await portFree(uiPort))) throw new Error(`Port ${uiPort} is in use. Pass --ui-port <n>.`);
  const sim = await startSim(a, cfg);
  let server: Server | undefined;
  try {
    const driver = simDriver(sim.base, cfg.appId, "lumi", skin);
    const engine = new Lumi(driver, { routes: cfg.routes, maxDepth: num("max-depth", 3) || 3, maxSteps: num("max-steps", 100) || 100, seed: a.seed !== undefined ? num("seed", 1) : undefined, skin, app: cfg.appId, testsDir: a["tests-dir"] && a["tests-dir"] !== "true" ? a["tests-dir"] : undefined });
    const first = await driver.open();
    if (!first.ok) throw new Error(`the app did not open: ${first.error ?? "no screen"}`);
    const frame = (await loadFrameRenderer())({ skin, lumi: true, screen: `<img data-part="screen" alt="The app on the phone, live" draggable="false">` });
    const shot = async () => {
      const r = await fetch(`${sim.base}/act`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: "lumi", action: "screenshot", format: "jpeg", inline: true }), signal: AbortSignal.timeout(10000) });
      if (!r.ok) return null;
      const j = (await r.json()) as { ok?: boolean; data?: string };
      return j.ok && j.data ? Buffer.from(j.data, "base64") : null;
    };
    server = await startLumiServer({ lumi: engine, page: lumiPage(frame, cfg.name), shot, port: uiPort });
    const url = `http://localhost:${uiPort}/`;
    console.error(`Lumi is on ${url}  (Ctrl-C to stop). Say "help" in the sidebar for commands.`);
    if (a["no-open"] !== "true") openBrowser(url);
    await new Promise<void>((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
    return 0;
  } finally { server?.close(); server?.closeAllConnections?.(); sim.stop(); }
}
