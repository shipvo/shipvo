// Browser check for Learn (issue #456): no horizontal scroll at 360 px, search and filters work, screenshots.
// Usage: node scripts/shots-learn.mjs [outDir]   (needs Playwright and Chromium)
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';
const pub = join(fileURLToPath(new URL('..', import.meta.url)), 'public'), out = process.argv[2] || '/tmp/agent/shots';
mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const srv = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]), f = join(pub, p);
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' }).end(readFileSync(f));
}).listen(0);
const base = `http://127.0.0.1:${srv.address().port}`, fail = [];
const b = await chromium.launch();
const pages = [['hub', '/learn/'], ['tutorial', '/learn/first-app/']];
const sizes = [['390x844', 390, 844], ['768x1024', 768, 1024], ['1440x900', 1440, 900], ['360x740', 360, 740]];
for (const scheme of ['light', 'dark']) for (const [sn, w, h] of sizes) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme }), pg = await ctx.newPage(); await pg.route((u) => !u.href.startsWith(base), (r) => r.abort());
  for (const [name, path] of pages) {
    await pg.goto(base + path); await pg.waitForLoadState('load'); await pg.waitForTimeout(300);
    const over = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 0) fail.push(`${path} ${sn} ${scheme}: horizontal scroll by ${over}px`);
    if (w === 360) {
      const small = await pg.evaluate(() => [...document.querySelectorAll('.chip,.side-toggle,.lcard')].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 43.5).length);
      if (small) fail.push(`${path} ${sn}: ${small} tap targets under 44px`);
    } else await pg.screenshot({ path: join(out, `${name}-${sn}-${scheme}.png`) });
  }
  if (w === 390 && scheme === 'light') {
    await pg.goto(base + '/learn/?type=video&goal=start'); await pg.waitForSelector('#lresults:not([hidden]) a');
    const n = await pg.locator('#lresults a').count();
    if (n !== 1) fail.push(`?type=video&goal=start shows ${n} results, want 1`);
    await pg.goto(base + '/learn/'); await pg.keyboard.press('/');
    if (await pg.evaluate(() => document.activeElement.id) !== 'lq') fail.push('/ does not focus the search');
    await pg.keyboard.type('zzzqq'); await pg.waitForSelector('.lempty');
    await pg.screenshot({ path: join(out, 'hub-empty-390.png') });
    await pg.goto(base + '/learn/first-app/'); await pg.click('.side-toggle'); await pg.fill('#sidefilter', 'simulator');
    const vis = await pg.evaluate(() => [...document.querySelectorAll('#side a')].filter((a) => !a.hidden && a.closest('.side-group:not([hidden])')).length);
    if (!vis) fail.push('sidebar filter hides everything for "simulator"');
  }
  await ctx.close();
}
await b.close(); srv.close();
if (fail.length) { console.error('learn browser check failed:\n- ' + fail.join('\n- ')); process.exit(1); }
console.log('learn browser check ok, screenshots in ' + out);
