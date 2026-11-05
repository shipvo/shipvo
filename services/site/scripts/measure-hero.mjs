// Measures the home hero mockup in a real Chromium (issue #149).
// Usage: node scripts/measure-hero.mjs [--shots <dir>]
// Needs a Chromium on PATH (or CHROME=/path). Serves public/ and pages/index.html,
// sets data-theme directly, and prints bounding boxes for each viewport and theme.
// Exits 1 if .agentview, .bubble or .result overlap .screen, or if .agentview and
// .result overlap each other, or any card leaves the stage, at any step of the replay.
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const types = { '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/') {
    const html = readFileSync(join(root, 'pages/index.html'), 'utf8')
      .replace('</head>', '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/site.css"></head>')
;
    res.setHeader('content-type', 'text/html'); return res.end(html);
  }
  const f = join(root, 'public', p);
  if (!p.includes('..') && existsSync(f) && extname(f)) { res.setHeader('content-type', types[extname(f)] ?? 'application/octet-stream'); return res.end(readFileSync(f)); }
  res.statusCode = 404; res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const chrome = spawn(process.env.CHROME || 'chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9333', '--user-data-dir=/tmp/agent/chrome-prof', 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 50 && !targets; i++) {
  try { targets = await (await fetch('http://127.0.0.1:9333/json')).json(); } catch { await new Promise((r) => setTimeout(r, 200)); }
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); };
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result.value;

const probe = `(() => {
  const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top + scrollY, r: r.right, b: r.bottom + scrollY }; };
  return { stage: q('.phone-stage'), screen: q('.screen'), device: q('.device'), bubble: q('.bubble'), agent: q('.agentview'), result: q('.result'), resultOn: !!document.querySelector('.result.on'), docW: document.documentElement.scrollWidth, vw: innerWidth };
})()`;
const hit = (a, b) => a.x < b.r - 0.5 && a.r > b.x + 0.5 && a.y < b.b - 0.5 && a.b > b.y + 0.5;
const inside = (a, s) => a.x >= s.x - 0.5 && a.r <= s.r + 0.5 && a.y >= s.y - 0.5 && a.b <= s.b + 0.5;
const fails = [];
const rows = [];
for (const theme of ['light', 'dark']) {
  for (const [w, h] of [[390, 844], [1101, 800], [1200, 800], [1201, 800], [1280, 800], [1440, 900]]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    await cdp('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 1200));
    await ev(`document.documentElement.setAttribute('data-theme','${theme}')`);
    // sample the whole replay: every step at its tallest, plus the final state with the result card
    const seen = [];
    for (let t = 0; t < 20; t++) { seen.push(await ev(probe)); await new Promise((r) => setTimeout(r, 700)); }
    await ev(`document.getElementById('result').classList.add('on')`);
    await new Promise((r) => setTimeout(r, 700));
    seen.push(await ev(probe));
    const tall = seen.reduce((a, b) => (b.agent.b - b.agent.y > a.agent.b - a.agent.y ? b : a));
    const last = seen[seen.length - 1];
    rows.push({ theme, w, h, agentHeightMin: Math.min(...seen.map((s) => s.agent.b - s.agent.y)), agentHeightMax: tall.agent.b - tall.agent.y, last });
    const tag = `${theme} ${w}px`;
    for (const s of seen) {
      if (s.docW > s.vw) fails.push(`${tag}: page scrolls sideways (${s.docW} > ${s.vw})`);
      for (const k of ['agent', 'bubble', 'result']) {
        if (hit(s[k], s.screen)) fails.push(`${tag}: .${k} covers .screen`);
        if (w > 1200 && (k !== 'result' || s === last) && !inside(s[k], s.stage)) fails.push(`${tag}: .${k} leaves .phone-stage`);
      }
      if (hit(s.agent, s.result)) fails.push(`${tag}: .agentview overlaps .result`);
      if (hit(s.agent, s.bubble)) fails.push(`${tag}: .agentview overlaps .bubble`);
      if (hit(s.result, s.bubble)) fails.push(`${tag}: .result overlaps .bubble`);
    }
    if (shotsDir) {
      const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(join(shotsDir, `hero-${theme}-${w}x${h}.png`), Buffer.from(shot.result.data, 'base64'));
    }
  }
}
const f = (b) => b && `x ${b.x.toFixed(0)}-${b.r.toFixed(0)} y ${b.y.toFixed(0)}-${b.b.toFixed(0)}`;
for (const r of rows) {
  console.log(`${r.theme} ${r.w}x${r.h}: agentview height ${r.agentHeightMin.toFixed(0)}..${r.agentHeightMax.toFixed(0)}px`);
  for (const k of ['stage', 'screen', 'bubble', 'agent', 'result']) console.log(`  .${k.padEnd(7)} ${f(r.last[k])}`);
}
chrome.kill(); server.close();
const uniq = [...new Set(fails)];
if (uniq.length) { console.error('\nFAIL\n' + uniq.join('\n')); process.exit(1); }
console.log('\nNo overlaps or overflow at any sampled step.');
process.exit(0);
