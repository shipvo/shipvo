// Guards for the Learn section (issue #436). Builds the site, then checks the built output:
// the hub lists every tutorial file and every video, the nav has Learn (active on Learn pages),
// old /docs/ Learn URLs redirect with 301, and no internal link in the built site is broken.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const site = fileURLToPath(new URL('..', import.meta.url)), repo = join(site, '..', '..'), pub = join(site, 'public');
execFileSync('node', ['build.mjs'], { cwd: site, stdio: 'ignore' });
const fail = [], read = (f) => readFileSync(join(pub, f), 'utf8');
const hub = read('learn/index.html');

for (const f of readdirSync(join(repo, 'docs/tutorials')).filter((f) => f.endsWith('.md') && f !== 'index.md')) {
  const slug = f.slice(0, -3), title = readFileSync(join(repo, 'docs/tutorials', f), 'utf8').match(/^# (.*)/)[1];
  if (!hub.includes(`href="/learn/${slug}/"`)) fail.push(`hub is missing tutorial ${slug}`);
  if (!hub.includes(`<b>${title}</b>`)) fail.push(`hub card for ${slug} lacks its title`);
  if (!existsSync(join(pub, 'learn', slug, 'index.html'))) fail.push(`no page for /learn/${slug}/`);
}
const videos = [...readFileSync(join(repo, 'docs/videos.md'), 'utf8').matchAll(/^###? (.+)\n+<video\b[^>]*data-length="([^"]*)"/gm)];
if (!videos.length) fail.push('found no videos in docs/videos.md');
for (const [, title, len] of videos) if (!hub.includes(`<b>${title}</b>`) || !hub.includes(`<span>${len}</span>`)) fail.push(`hub is missing video "${title}" or its length`);
if (!/lvideo[^>]*>\s*<img src="\/videos\//.test(hub)) fail.push('video cards need their poster');
for (const g of ['Start', 'Sell']) if (!hub.includes(`>${g}</span>`)) fail.push(`hub lacks goal group ${g}`);
for (const l of ['/learn/glossary/', '/learn/videos/', '/docs/overview/']) if (!hub.includes(`href="${l}"`)) fail.push(`hub lacks link to ${l}`);

// nav: Learn between Docs and Pricing, active on Learn pages only
for (const [f, on] of [['learn/index.html', true], ['learn/first-app/index.html', true], ['learn/videos/index.html', true], ['learn/glossary/index.html', true], ['docs/cli/index.html', false], ['index.html', false], ['blog/index.html', false]]) {
  const h = read(f), nav = h.match(/<nav class="primary"[\s\S]*?<\/nav>/)?.[0] ?? '';
  const m = nav.match(/<a href="\/docs\/"[^>]*>Docs<\/a>\s*<a href="\/learn\/" class="([^"]*)">Learn<\/a>\s*<div[\s\S]*<a href="\/pricing\/"/);
  if (!m) fail.push(`${f}: nav needs Learn between Docs and Pricing`);
  else if ((m[1] === 'on') !== on) fail.push(`${f}: Learn active state should be ${on}`);
  if (!/<div class="mobile-menu"[\s\S]*?<a href="\/learn\/">Learn<\/a>/.test(h)) fail.push(`${f}: mobile menu needs Learn`);
}
if (read('docs/overview/index.html').includes('href="/docs/learn/"')) fail.push('docs still link to /docs/learn/');
const docSide = read('docs/cli/index.html').match(/<aside class="side"[\s\S]*?<\/aside>/)[0];
if (/href="\/(docs|learn)\/(first-app|your-own-shop|glossary|videos)\//.test(docSide)) fail.push('Docs sidebar still has Learn pages');
if ((docSide.match(/href="\/learn\/"/g) || []).length !== 1) fail.push('Docs sidebar must link to /learn/ exactly once');
if (!/side-title">Tutorials/.test(read('learn/videos/index.html'))) fail.push('Learn sidebar needs a Tutorials group');

// machine-readable: sitemap list, llms.txt, search index
const sm = read('sitemap-static.txt'), llms = read('llms.txt'), idx = JSON.parse(read('docs/index.json'));
for (const p of ['/learn/', '/learn/first-app/', '/learn/videos/', '/learn/glossary/']) if (!sm.includes(p + '\t')) fail.push(`sitemap lacks ${p}`);
if (sm.includes('/docs/first-app/') || sm.includes('/docs/learn/')) fail.push('sitemap still has old Learn URLs');
if (!llms.includes('https://shipvo.dev/learn/first-app.md') || !llms.includes('https://shipvo.dev/learn/')) fail.push('llms.txt lacks Learn URLs');
if (!idx.some((e) => e.path === '/learn/first-app/')) fail.push('search index lacks /learn/first-app/');

// redirects (service worker entry point, run with type stripping)
const { default: worker } = await import('../src/index.ts');
const env = { ASSETS: { fetch: async () => new Response('ok') }, API: 'https://api.invalid' };
const old = { '/docs/learn/': '/learn/', '/docs/learn': '/learn/', '/docs/first-app/': '/learn/first-app/', '/docs/your-own-shop/': '/learn/your-own-shop/', '/docs/videos/': '/learn/videos/', '/docs/glossary/': '/learn/glossary/', '/docs/glossary.md': '/learn/glossary.md' };
for (const [from, to] of Object.entries(old)) {
  const r = await worker.fetch(new Request('https://shipvo.dev' + from), env);
  if (r.status !== 301 || r.headers.get('location') !== 'https://shipvo.dev' + to) fail.push(`${from} should 301 to ${to}, got ${r.status} ${r.headers.get('location')}`);
}
const ok = await worker.fetch(new Request('https://shipvo.dev/docs/cli/'), env);
if (ok.status !== 200) fail.push('/docs/cli/ must not redirect');

// link check over the built site
const files = [];
(function walk(d) { for (const n of readdirSync(d)) { const p = join(d, n); if (n === 'node_modules') continue; statSync(p).isDirectory() ? walk(p) : n.endsWith('.html') && files.push(p); } })(pub);
const exists = (path) => { const f = join(pub, path.replace(/\/$/, '')); return existsSync(join(f, 'index.html')) || (existsSync(f) && statSync(f).isFile()) || existsSync(f + '.html') || path === '/' ; };
const dynamic = /^\/(apps|hq|media|api|\.well-known|sitemap\.xml|docs$)/;
let checked = 0;
for (const file of files) for (const [, href] of readFileSync(file, 'utf8').matchAll(/<a [^>]*href="(\/[^"#?]*)/g)) {
  checked++;
  if (!dynamic.test(href) && !exists(href)) fail.push(`broken link ${href} in ${file.slice(pub.length)}`);
}
console.log(`link check: ${checked} internal links in ${files.length} pages`);
if (fail.length) { console.error('learn check failed:\n- ' + [...new Set(fail)].join('\n- ')); process.exit(1); }
console.log('learn check ok');
