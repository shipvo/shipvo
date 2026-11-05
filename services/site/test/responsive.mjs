// Issue #455. Responsive layout check for every page in the sitemap, in a real Chromium (Playwright).
// Usage: node test/responsive.mjs [--shots <dir>] [--only <path-substring>] [--report]
//   default: checks 360x780 and 390x844, light and dark; fails on any problem.
//   --shots <dir>: also writes full-page screenshots at 360, 390, 768 and 1440, light and dark.
// Needs `pnpm --filter @shipvo/site build` first. Skipped with a note when Playwright or Chromium is missing, unless CI=true.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const pub = join(root, 'public');
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const shotsDir = arg('--shots');
const only = arg('--only');

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  if (process.env.CI) { console.error('responsive: playwright not installed'); process.exit(1); }
  console.log('responsive: playwright not installed, skipped'); process.exit(0);
}
if (!existsSync(join(pub, 'sitemap-static.txt'))) { console.error('responsive: run the site build first'); process.exit(1); }

const paths = readFileSync(join(pub, 'sitemap-static.txt'), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')[0]).filter((p) => !only || p.includes(only));
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.json': 'application/json', '.md': 'text/markdown', '.txt': 'text/plain' };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const cands = [join(pub, p), join(pub, p, 'index.html'), join(pub, p + '.html')];
  const f = !p.includes('..') && cands.find((c) => existsSync(c) && statSync(c).isFile());
  if (!f) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', types[extname(f)] ?? 'application/octet-stream');
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

let browser;
try { browser = await chromium.launch(); } catch (e) {
  server.close();
  if (process.env.CI) { console.error('responsive: no Chromium: ' + e.message.split('\n')[0]); process.exit(1); }
  console.log('responsive: no Chromium, skipped'); process.exit(0);
}

// Runs in the page. Returns a list of problem strings.
const probe = () => {
  const out = [];
  const vw = innerWidth;
  const d = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  if (document.documentElement.scrollWidth > vw) out.push(`horizontal scroll: scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
  const inScroller = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true; } return false; };
  const hidden = (e) => { const s = getComputedStyle(e); return s.display === 'none' || s.visibility === 'hidden' || e.closest('[hidden]'); };
  let wide = 0;
  for (const e of document.body.querySelectorAll('*')) {
    if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') continue;
    if (hidden(e) || getComputedStyle(e).position === 'fixed') continue;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (inScroller(e)) continue; // clipped or scrolled by an ancestor (code blocks, table wrappers)
    if (e.matches('a.anchor')) continue; // heading hash links, hover only
    if (r.width > vw + 0.5) { if (wide++ < 6) out.push(`wider than viewport: ${d(e)} is ${Math.round(r.width)}px`); }
    else if ((r.right > vw + 0.5 || r.left < -0.5) && !inScroller(e) && getComputedStyle(e).position !== 'absolute') { if (wide++ < 6) out.push(`outside viewport: ${d(e)} spans ${Math.round(r.left)}..${Math.round(r.right)}`); }
  }
  // tap targets: nav and buttons (the mobile menu is checked separately, after it opens)
  const targets = document.querySelectorAll('.nav button, .nav .btn, .nav .logo, .burger, button:not([hidden]), .btn, a.btn, [role=button], input[type=submit]');
  const seen = new Set();
  for (const e of targets) {
    if (seen.has(e) || hidden(e)) continue; seen.add(e);
    const r = e.getBoundingClientRect();
    if (r.width && (r.height < 43.5 || r.width < 43.5)) out.push(`small tap target: ${d(e)} ${Math.round(r.width)}x${Math.round(r.height)} "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30)}"`);
  }
  for (const e of document.querySelectorAll('img, video, iframe, canvas, svg')) {
    if (hidden(e) || e.closest('button, a.gh, .burger, .theme-btn')) continue;
    const r = e.getBoundingClientRect();
    if (r.width > vw + 0.5) out.push(`media wider than viewport: ${d(e)} ${Math.round(r.width)}px`);
  }
  const fs = parseFloat(getComputedStyle(document.body).fontSize);
  if (fs < 16) out.push(`base font ${fs}px < 16px`);
  const html = parseFloat(getComputedStyle(document.documentElement).fontSize);
  if (html < 16) out.push(`html font ${html}px < 16px`);
  return out;
};

const menuProbe = async (page) => {
  const out = [];
  const burger = page.locator('.burger');
  if (!(await burger.isVisible())) return ['mobile menu button is not visible'];
  await burger.click();
  const items = await page.$$eval('.mobile-menu a', (as) => as.filter((a) => a.offsetParent).map((a) => { const r = a.getBoundingClientRect(); return [a.textContent.trim(), r.height, r.width]; }));
  for (const [t, h, w] of items) if (h < 43.5 || w < 43.5) out.push(`small mobile menu link: "${t}" ${Math.round(w)}x${Math.round(h)}`);
  if (!items.length) out.push('mobile menu opened with no links');
  // keyboard: focus moves into the menu, Tab wraps inside it, focus is visible, Escape closes and returns focus to the button
  const active = () => page.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); return { in: !!e.closest('.mobile-menu') || e.classList.contains('burger'), outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2, burger: e.classList.contains('burger') }; });
  let a = await active();
  if (!a.in) out.push('menu opened but focus did not move into it');
  for (let i = 0; i < items.length + 3; i++) {
    await page.keyboard.press('Tab'); a = await active();
    if (!a.in) { out.push('Tab left the open mobile menu'); break; }
    if (i === 0 && !a.outline) out.push('keyboard-focused menu link has no visible focus ring');
  }
  await page.keyboard.press('Escape');
  a = await active();
  if (await page.locator('.mobile-menu').isVisible()) out.push('Escape did not close the mobile menu');
  if (!a.burger) out.push('after Escape, focus is not back on the menu button');
  return out;
};

const sizes = [[360, 780], [390, 844], [768, 1024], [1440, 900]];
let failures = 0, checked = 0;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
for (const [w, h] of sizes) {
  if (!shotsDir && w > 768) continue;
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 1, hasTouch: w < 768, reducedMotion: 'reduce' });
    // keep the check offline: external requests (GitHub stars, status, badges, phone embeds) are aborted
    await ctx.route((u) => !u.href.startsWith(base), (r) => r.abort());
    const page = await ctx.newPage();
    for (const p of paths) {
      try { await page.goto(base + p, { waitUntil: 'load', timeout: 20000 }); } catch (e) { console.log(`FAIL ${p} @${w} ${scheme}: ${e.message.split('\n')[0]}`); failures++; continue; }
      await page.waitForTimeout(150);
      if (shotsDir) await page.screenshot({ path: join(shotsDir, `${p.replace(/^\/|\/$/g, '').replace(/\//g, '_') || 'home'}-${w}-${scheme}.png`), fullPage: true });
      if (w === 768) { const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); checked++; if (sw[0] > sw[1]) { console.log(`FAIL ${p} @${w} ${scheme}: horizontal scroll: scrollWidth ${sw[0]} > ${sw[1]}`); failures++; } continue; }
      if (w > 390) continue;
      const problems = await page.evaluate(probe);
      if (scheme === 'light') problems.push(...(await menuProbe(page)));
      checked++;
      for (const m of problems) { console.log(`FAIL ${p} @${w} ${scheme}: ${m}`); failures++; }
    }
    await ctx.close();
  }
}
await browser.close(); server.close();
console.log(`responsive: ${paths.length} pages, ${checked} page views checked, ${failures} problem${failures === 1 ? '' : 's'}`);
process.exit(failures ? 1 : 0);
