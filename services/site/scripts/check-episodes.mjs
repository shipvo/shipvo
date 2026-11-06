// Series episodes (owner, 6 Nov 2026): an episode that opens with a recap carries
// data-recap-end, and data-prev + data-prev-title so the "Watch previous" and
// "Skip recap" buttons (public/shell.js) can show while the recap plays.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const p = (f) => fileURLToPath(new URL('../' + f, import.meta.url));
const fail = [];
const js = readFileSync(p('public/shell.js'), 'utf8');
const css = readFileSync(p('public/site.css'), 'utf8');
if (!/video\[data-recap-end\]/.test(js) || !/Skip recap/.test(js)) fail.push('shell.js must add the recap buttons to video[data-recap-end]');
if (!/\.ep-btn\{[^}]*min-height:44px/.test(css)) fail.push('.ep-btn needs a 44px tap target');
const md = readFileSync(p('../../docs/videos.md'), 'utf8');
for (const m of md.matchAll(/<video\b([^>]*)>/g)) {
  const a = m[1];
  const end = a.match(/data-recap-end="([^"]*)"/)?.[1];
  if (end === undefined) continue;
  const title = a.match(/data-title="([^"]*)"/)?.[1] ?? '(untitled)';
  if (!(Number(end) > 0 && Number(end) <= 15)) fail.push(`${title}: data-recap-end must be 1 to 15 seconds`);
  if (!/data-prev="[^"]+"/.test(a) || !/data-prev-title="[^"]+"/.test(a)) fail.push(`${title}: a recap needs data-prev and data-prev-title`);
}
if (fail.length) { console.error('episodes check failed:\n- ' + fail.join('\n- ')); process.exit(1); }
console.log('episodes check ok');
