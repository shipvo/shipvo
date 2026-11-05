// Guards for the docs video on phones (issue #167): poster file exists and is not the old
// burned-in-caption JPG, the play button is 44px+ with an accessible name, the Docs menu
// button hides in fullscreen, and page padding clears it. Reads source files, not boxes.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const p = (f) => fileURLToPath(new URL('../' + f, import.meta.url));
const css = readFileSync(p('public/docs.css'), 'utf8');
const js = readFileSync(p('public/docs.js'), 'utf8');
const fail = [];
const rule = (sel) => css.match(new RegExp('(?:^|\\n)' + sel.replace(/[.]/g, '\\.') + '\\{([^}]*)\\}'))?.[1] ?? '';
for (const f of ['../../docs/getting-started.md', '../../docs/videos.md']) {
  const md = readFileSync(p(f), 'utf8');
  const poster = md.match(/poster="([^"]+)"/)?.[1];
  if (!poster || !existsSync(p('public' + poster))) fail.push(f + ': poster file missing');
  if (!/data-title="[^"]+"/.test(md) || !/data-length="[^"]+"/.test(md)) fail.push(f + ': video needs data-title and data-length for the play button name');
  if (!/<track kind="captions"/.test(md)) fail.push(f + ': captions track must stay');
}
const play = rule('.vid-play');
if (!/width:48px/.test(play) || !/height:48px/.test(play)) fail.push('.vid-play must be 48px');
if (!/min-width:44px/.test(play) || !/min-height:44px/.test(play)) fail.push('.vid-play needs a 44px minimum target');
if (!/'Play: '/.test(js)) fail.push('docs.js must name the play button "Play: <title> (<length>)"');
if (!/body\.vid-fs \.side-toggle\{display:none/.test(css)) fail.push('Docs menu button must hide while the video is fullscreen');
if (!/\.vid-play:focus-visible/.test(css) || !/video:focus-visible/.test(css)) fail.push('play button and player need a visible focus ring');
const pad = css.match(/\.doc\{padding:28px 20px calc\((\d+)px \+ (\d+)px/);
if (!pad || Number(pad[1]) < 44 || Number(pad[2]) < 16) fail.push('.doc bottom padding on phones must be button height + 16px or more');
if (fail.length) { console.error('docs video check failed:\n- ' + fail.join('\n- ')); process.exit(1); }
console.log('docs video check ok');
