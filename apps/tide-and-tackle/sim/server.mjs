#!/usr/bin/env node
// PureNative UI simulator: runs the real app UI (React Native Web build) in a phone-sized headless browser,
// and lets an agent see the screen as an accessibility tree and act on it: tap, type, scroll, back.
// No emulator, no device. Each session also gets a mock control plane that records orders for grading.
//   node sim/server.mjs [--port 4545] [--dir /tmp/pn-ui]
import http from "node:http";
import { readFileSync, existsSync, writeFileSync, appendFileSync, mkdirSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg("port", 4545)), DIR = arg("dir", "/tmp/pn-ui"), DIST = join(here, "..", "sim-dist");
mkdirSync(DIR, { recursive: true });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".ttf": "font/ttf", ".css": "text/css" };
const browser = await chromium.launch();
const sessions = new Map();

const phone = { ...devices["Pixel 5"], viewport: { width: 393, height: 851 } };

async function newSession(id, opts = {}) {
  if (sessions.has(id)) await sessions.get(id).ctx.close();
  writeFileSync(join(DIR, `${id}.json`), JSON.stringify({ orders: [] })); writeFileSync(join(DIR, `${id}.json.log`), "");
  const ctx = await browser.newContext({ ...phone, colorScheme: opts.dark ? "dark" : "light" });
  await ctx.addInitScript((cfg) => { globalThis.__PN_SIM__ = cfg; }, { baseUrl: `http://localhost:${PORT}/s/${id}`, appId: "tide", seed_cart: opts.seed_cart ?? null });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  sessions.set(id, { ctx, page });
}

async function screen(page) {
  await page.waitForTimeout(150);
  const tree = await page.locator("body").ariaSnapshot({ mode: "ai" });
  // Trim layout-only noise so the agent sees what a screen reader would.
  return tree.split("\n").filter((l) => !/^\s*- generic \[ref=e\d+\]:?\s*$/.test(l)).join("\n");
}

function log(id, action, ok, extra = {}) { appendFileSync(join(DIR, `${id}.json.log`), JSON.stringify({ at: Date.now(), name: action, ok, ...extra }) + "\n"); }

async function act(id, body) {
  const s = sessions.get(id); if (!s) throw new Error(`no session '${id}': call /session first`);
  const { page } = s; const loc = (ref) => page.locator(`aria-ref=${ref}`);
  switch (body.action) {
    case "screen": break;
    case "tap": await loc(body.ref).click({ timeout: 3000 }); break;
    case "type": await loc(body.ref).fill(String(body.text ?? ""), { timeout: 3000 }); if (body.enter) await loc(body.ref).press("Enter"); break;
    case "scroll": {
      const target = body.ref ? loc(body.ref) : page.locator("body");
      const box = await target.boundingBox().catch(() => null);
      if (box) await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 400));
      await page.mouse.wheel(body.direction === "right" ? 300 : body.direction === "left" ? -300 : 0, body.direction === "up" ? -600 : body.direction === "down" ? 600 : 0);
      break;
    }
    case "back": { const b = page.getByRole("button", { name: "Back", exact: true }); if (await b.count()) await b.first().click(); else throw new Error("no Back button on this screen"); break; }
    case "screenshot": { const p = join(DIR, `${id}-${Date.now()}.png`); await page.screenshot({ path: p }); return { path: p, screen: await screen(page) }; }
    default: throw new Error(`unknown action '${body.action}'. Actions: screen, tap, type, scroll, back, screenshot`);
  }
  return { screen: await screen(page) };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x"); const send = (code, obj, type = "application/json") => { res.writeHead(code, { "content-type": type, "access-control-allow-origin": "*", "access-control-allow-headers": "*" }); res.end(type === "application/json" ? JSON.stringify(obj) : obj); };
  try {
    if (req.method === "OPTIONS") return send(204, "", "text/plain");
    // the app's static web build
    if (url.pathname.startsWith("/_expo/") || url.pathname.startsWith("/assets/") || url.pathname === "/favicon.ico") {
      const p = join(DIST, decodeURIComponent(url.pathname)); if (existsSync(p)) return send(200, readFileSync(p), MIME[extname(p)] ?? "application/octet-stream");
    }
    if (url.pathname.startsWith("/app/")) {
      let p = join(DIST, url.pathname.slice(5) || "index.html"); if (!existsSync(p) || statSync(p).isDirectory()) p = join(DIST, "index.html");
      return send(200, readFileSync(p), MIME[extname(p)] ?? "application/octet-stream");
    }
    // mock control plane per session
    const m = url.pathname.match(/^\/s\/([\w-]+)\/(.*)$/);
    if (m) {
      const [, id, rest] = m;
      if (rest.startsWith("c/")) return send(404, { error: "no_content" }); // use the bundled content
      if (rest.startsWith("o/") && req.method === "POST") {
        let b = ""; for await (const ch of req) b += ch;
        const f = join(DIR, `${id}.json`); const st = JSON.parse(readFileSync(f, "utf8")); st.orders.push(JSON.parse(b).order); writeFileSync(f, JSON.stringify(st));
        return send(202, { ok: true });
      }
      return send(202, { ok: true }); // telemetry etc.
    }
    // agent API
    if (req.method !== "POST") return send(404, { error: "not found" });
    let raw = ""; for await (const ch of req) raw += ch; const body = raw ? JSON.parse(raw) : {};
    if (url.pathname === "/session") { await newSession(body.session, body); const s = sessions.get(body.session); log(body.session, "start", true); return send(200, { ok: true, screen: await screen(s.page) }); }
    if (url.pathname === "/act") {
      try { const r = await act(body.session, body); log(body.session, body.action, true, body.ref ? { ref: body.ref } : {}); return send(200, { ok: true, ...r }); }
      catch (e) { log(body.session, body.action, false); const s = sessions.get(body.session); return send(200, { ok: false, error: String(e.message).split("\n")[0], screen: s ? await screen(s.page) : null }); }
    }
    send(404, { error: "not found" });
  } catch (e) { send(500, { error: String(e) }); }
});
server.listen(PORT, () => console.log(`PureNative UI simulator on http://localhost:${PORT} (sessions in ${DIR})`));
