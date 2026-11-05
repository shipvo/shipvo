// Issue #458. Every standalone link, button and <summary> on every sitemap page is at least 44x44 px
// at 390x844 and 768x1024, and the page does not scroll sideways. Exempt: links inside p, li, td, pre.
// Uses Chromium over CDP (no extra dependency). Skipped with a note when no Chromium is found, unless CI=true.
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url)), pub = join(root, 'public');
const pw = join(homedir(), '.cache/ms-playwright');
const pwChrome = existsSync(pw) ? readdirSync(pw).filter((d) => d.startsWith('chromium-')).flatMap((d) => ['chrome-linux64', 'chrome-linux'].map((x) => join(pw, d, x, 'chrome'))) : [];
const chromeBin = process.env.CHROME || [...pwChrome, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
if (!chromeBin) { if (process.env.CI) { console.error('tap targets: no Chromium found'); process.exit(1); } console.log('tap targets: no Chromium, check skipped'); process.exit(0); }

const paths = readFileSync(join(pub, 'sitemap-static.txt'), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')[0]);
for (const extra of ['/learn/', '/learn/videos/', '/learn/glossary/', '/terms/', '/privacy/', '/security/', '/acceptable-use/']) if (!paths.includes(extra)) paths.push(extra);

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = join(pub, p);
  if (!f.startsWith(pub)) { res.statusCode = 403; return res.end(); }
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  else if (!existsSync(f) && existsSync(f + '.html')) f += '.html';
  if (!existsSync(f)) { res.statusCode = 404; return res.end('no'); }
  res.setHeader('content-type', TYPES[extname(f)] || 'application/octet-stream'); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const PORT = 9400 + Math.floor(Math.random() * 500), PROF = `/tmp/agent/chrome-tap-${process.pid}`;
const chrome = spawn(chromeBin, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROF}`, 'about:blank'], { stdio: 'ignore' });
const done = (c) => { chrome.kill(); server.close(); process.exit(c); };

const probe = `(() => {
  const bad = [];
  for (const el of document.querySelectorAll('a[href], button, summary, [role=button]')) {
    if (el.closest('p, li, td, pre') && el.matches('a') && !el.closest('nav, header, footer, .mobile-menu')) continue;
    if (el.matches('a') && el.closest('p, td, pre')) continue;
    if (el.matches('a.anchor') && el.closest('h1,h2,h3,h4,h5,h6')) continue; // heading permalinks sit inside the heading
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden]') || el.closest('.skip') === el || el.classList.contains('skip')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.width < 43.5 || r.height < 43.5) bad.push((el.parentElement.tagName.toLowerCase() + '.' + el.parentElement.className + ' > ' + el.tagName.toLowerCase() + '.' + el.className + ' "' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30) + '" ' + Math.round(r.width) + 'x' + Math.round(r.height)));
  }
  return JSON.stringify({ bad, sw: document.documentElement.scrollWidth, vw: innerWidth });
})()`;

const failures = [];
try {
  let targets;
  for (let i = 0; i < 100 && !targets?.some((t) => t.type === 'page'); i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch {} await new Promise((r) => setTimeout(r, 200)); }
  const tab = targets?.find((t) => t.type === 'page');
  if (!tab) throw new Error('Chromium did not expose a page target');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); };
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  for (const [w, h] of [[390, 844], [768, 1024]]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    for (const p of paths) {
      await cdp('Page.navigate', { url: base + p });
      await new Promise((r) => setTimeout(r, 350));
      const v = (await cdp('Runtime.evaluate', { expression: probe, returnByValue: true })).result.result.value;
      if (!v) { failures.push(`${w}px ${p}: probe failed`); continue; }
      const o = JSON.parse(v);
      for (const b of [...new Set(o.bad)]) failures.push(`${w}px ${p}: ${b}`);
      if (o.sw > o.vw) failures.push(`${w}px ${p}: horizontal scroll (${o.sw} > ${o.vw})`);
    }
  }
  if (failures.length) { console.error('Tap targets under 44x44 or sideways scroll:\n' + failures.join('\n')); done(1); }
  console.log(`tap targets: ${paths.length} pages x 2 widths ok`);
  done(0);
} catch (e) { console.error(e); done(1); }
