// Guards the home hero phone mockup layout rules in public/site.css (issue #149).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../public/site.css', import.meta.url)), 'utf8');
const rule = (sel) => css.match(new RegExp('(?:^|\\n)' + sel.replace(/\./g, '\\.') + '\\{([^}]*)\\}'))?.[1] ?? '';
const fail = [];

if (/(^|;)\s*(height|max-height)\s*:/.test(rule('.tree'))) fail.push('.tree must size to its content (no fixed height)');

const overlap = rule('.agentview').match(/right:calc\(4% \+ 272px - (\d+)px\)/);
if (!overlap || Number(overlap[1]) > 24) fail.push('.agentview must overlap the phone edge by at most 24px');

if (!/top:0\b/.test(rule('.bubble'))) fail.push('.bubble must sit above the phone');
if (!/padding:1[4-9]\dpx/.test(rule('.phone-stage'))) fail.push('.phone-stage needs top padding that clears the bubble');
if (!/@media\(max-width:1100px\)\{\.phone-stage\{[^@]*flex-direction:column/.test(css)) fail.push('cards must stack under 1100px');

if (fail.length) { console.error(fail.join('\n')); process.exit(1); }
console.log('Hero mockup layout rules hold.');
