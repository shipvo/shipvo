// A CSS-rule guard for the home hero phone mockup (issue #149), not a layout test.
// Update the regexes below if you reformat the hero rules in site.css.
// It reads public/site.css, rebuilds the stage width from the grid rules and checks
// the side-by-side cards fit inside it at every viewport that is not stacked.
// It cannot see real boxes. For that run `node scripts/measure-hero.mjs` (needs Chromium).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../public/site.css', import.meta.url)), 'utf8');
const rule = (sel) => css.match(new RegExp('(?:^|\\n)' + sel.replace(/\./g, '\\.') + '\\{([^}]*)\\}'))?.[1] ?? '';
const fail = [];

const treeMin = Number(rule('.tree').match(/min-height:(\d+)px/)?.[1]);
if (!(treeMin >= 200)) fail.push('.tree needs a min-height that fits the tallest step, so the card does not jump');
if (/(^|;)\s*(height|max-height)\s*:/.test(rule('.tree'))) fail.push('.tree must size to its content (no fixed height)');

const agent = rule('.agentview');
const overlap = agent.match(/right:calc\(4% \+ 272px - (\d+)px\)/);
const cardW = Number(agent.match(/width:(\d+)px/)?.[1]);
if (!overlap || Number(overlap[1]) > 9) fail.push('.agentview must overlap the phone edge by at most 9px (the bezel)');
if (!cardW) fail.push('.agentview needs a fixed px width');

if (!/top:0\b/.test(rule('.bubble'))) fail.push('.bubble must sit above the phone');
const stage = rule('.phone-stage');
const padTop = Number(stage.match(/padding:(\d+)px 0 (\d+)px/)?.[1]);
const padBottom = Number(stage.match(/padding:(\d+)px 0 (\d+)px/)?.[2]);
if (!(padTop >= 140)) fail.push('.phone-stage needs top padding that clears the bubble');
if (!/bottom:0\b/.test(rule('.result')) || !(padBottom >= 100)) fail.push('.result must sit below the phone, in bottom padding that fits it');

const stackMax = Number(css.match(/@media\(max-width:(\d+)px\)\{\.phone-stage\{[^@]*flex-direction:column/)?.[1]);
const colsMin = Number(css.match(/@media\(min-width:(\d+)px\)\{\.hero \.wrap\{grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)\}/)?.[1]);
if (!stackMax) fail.push('cards must stack at narrow widths');
else if (colsMin !== stackMax + 1) fail.push('equal hero columns must start right after the stacking breakpoint');
else if (overlap && cardW) {
  const clamp = (lo, v, hi) => Math.min(hi, Math.max(lo, v));
  for (let vw = stackMax + 1; vw <= 3000; vw++) {
    const gut = clamp(20, vw * 0.05, 64);
    const gap = clamp(32, vw * 0.05, 72);
    const stageW = (Math.min(vw, 1200) - 2 * gut - gap) / 2;
    const need = 0.04 * stageW + 272 - Number(overlap[1]) + cardW;
    if (need > stageW) { fail.push(`at ${vw}px the cards need ${need.toFixed(0)}px but the stage is ${stageW.toFixed(0)}px`); break; }
  }
}

if (fail.length) { console.error(fail.join('\n')); process.exit(1); }
console.log('Hero mockup layout rules hold.');
