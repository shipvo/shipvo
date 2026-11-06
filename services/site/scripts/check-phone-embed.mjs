// Issue #420. Unit checks for the phone embed transform, then a Chromium check that the frame renders,
// the iframe loads, the fallback shows when the release is missing, and 375 px does not scroll sideways.
// The browser part serves a fake releases API locally. It is skipped (with a note) when no Chromium is found,
// unless CI=true, where a missing Chromium is a failure.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { transformPhones, phoneSrc } from '../phone-embed.mjs';

const tag = (a) => `<div data-shipvo-phone ${a}></div>`;
let h = transformPhones(`<p>x</p>\n${tag('data-app="tide" data-release="27" data-path="/cart" data-caption="Try it"')}`);
assert.match(h, /<iframe title="Live phone: Try it" width="390" height="844" loading="lazy" src="https:\/\/api\.shipvo\.dev\/w\/tide\/r27\/cart">/);
assert.match(h, /Open full screen/); assert.match(h, /data-phone-reload/);
assert.doesNotMatch(h, /data-shipvo-phone/);
h = transformPhones(tag('data-app="tide" data-release="latest" data-path="/"'));
assert.match(h, /<iframe [^>]*loading="lazy"\s*><\/iframe>/); assert.doesNotMatch(h, /src=/); assert.match(h, /data-release="latest"/);
h = transformPhones(tag('data-app="../x" data-release="latest" data-fallback="/a.png"'));
assert.match(h, /phone-failed/); assert.doesNotMatch(h, /<iframe/); assert.match(h, /\/a\.png/);
assert.equal(phoneSrc({ app: 'tide', release: 5, path: '//evil.com' }), null);
assert.equal(phoneSrc({ app: 'tide', release: 'x' }), null);
console.log('phone embed: transform ok');

const pw = join(homedir(), '.cache/ms-playwright');
const pwChrome = existsSync(pw) ? readdirSync(pw).filter((d) => d.startsWith('chromium-')).flatMap((d) => ['chrome-linux64', 'chrome-linux'].map((x) => join(pw, d, x, 'chrome'))) : [];
const chromeBin = process.env.CHROME || [...pwChrome, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
if (!chromeBin) { if (process.env.CI) { console.error('phone embed: no Chromium found'); process.exit(1); } console.log('phone embed: no Chromium, browser check skipped'); process.exit(0); }

const root = fileURLToPath(new URL('..', import.meta.url));
let base;
const page = (body) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/docs.css"><body><main class="prose">${transformPhones(body)}</main><script src="/phone.js"></script>`;
const server = createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const send = (t, b, code = 200) => { res.statusCode = code; res.setHeader('content-type', t); res.end(b); };
  if (p === '/ok') return send('text/html', page(tag(`data-app="tide" data-release="latest" data-caption="Try it" data-fallback="/f.png" data-api="${base}/w"`)));
  if (p === '/missing') return send('text/html', page(tag(`data-app="tide" data-release="99" data-caption="Try it" data-fallback="/f.png" data-api="${base}/w"`)));
  if (p === '/w/tide/releases.json') return send('application/json', '{"releases":[27,28],"latest":28}');
  if (p === '/w/tide/r28/') return send('text/html', '<title>app</title><h1>Tide</h1>');
  if (p === '/docs.css') return send('text/css', readFileSync(join(root, 'public/docs.css')));
  if (p === '/phone.js') return send('text/javascript', readFileSync(join(root, 'public/phone.js')));
  send('text/plain', 'no', 404);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
base = `http://127.0.0.1:${server.address().port}`;

const PORT = 9400 + Math.floor(Math.random() * 500), PROF = `/tmp/agent/chrome-phone-${process.pid}`;
const chrome = spawn(chromeBin, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROF}`, 'about:blank'], { stdio: 'ignore' });
const done = (code) => { chrome.kill(); server.close(); process.exit(code); };
try {
  let targets;
  for (let i = 0; i < 100 && !targets?.some((t) => t.type === 'page'); i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch {} await new Promise((r) => setTimeout(r, 200)); }
  const page = targets?.find((t) => t.type === 'page');
  if (!page) throw new Error('Chromium did not expose a page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); };
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => (await cdp('Runtime.evaluate', { expression: e, returnByValue: true })).result.result.value;
  await cdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 1, mobile: true });

  await cdp('Page.navigate', { url: base + '/ok' });
  // Poll instead of a fixed sleep: CI runs other test suites at the same time.
  for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 200)); if ((await ev(`document.querySelector('iframe')?.contentDocument?.title || ''`)) === 'app') break; }
  const ok = JSON.parse(await ev(`JSON.stringify({src:document.querySelector('iframe')?.src, title:document.querySelector('iframe')?.title,
    full:document.querySelector('[data-phone-full]').href, sw:document.documentElement.scrollWidth, vw:innerWidth,
    loaded:document.querySelector('iframe')?.contentDocument?.title, h:document.querySelector('.phone-box').getBoundingClientRect().height})`));
  assert.equal(ok.src, base + '/w/tide/r28/'); assert.equal(ok.full, ok.src); assert.ok(ok.title);
  assert.equal(ok.loaded, 'app', 'iframe loaded the app');
  assert.ok(ok.sw <= ok.vw, `no sideways scroll at 375px (${ok.sw} > ${ok.vw})`);
  assert.ok(ok.h < 844, 'phone scaled down to fit');

  await cdp('Page.navigate', { url: base + '/missing' }); await new Promise((r) => setTimeout(r, 1000));
  const bad = JSON.parse(await ev(`JSON.stringify({iframe:!!document.querySelector('iframe'), msg:!document.querySelector('.phone-msg').hidden, shot:!document.querySelector('.phone-shot').hidden})`));
  assert.deepEqual(bad, { iframe: false, msg: true, shot: true });
  console.log('phone embed: browser ok');
  done(0);
} catch (e) { console.error(e); done(1); }
