// Computes WCAG contrast for text tokens in public/site.css and fails below 4.5:1.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../public/site.css', import.meta.url)), 'utf8');

function vars(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2];
  return out;
}
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const dark = vars(css.match(/:root\{([^}]*)\}/)[1]);
const lightExplicit = vars(css.match(/:root\[data-theme=light\]\{(--ink[^}]*)\}/)[1]);
const lightMedia = vars(css.match(/:root:not\(\[data-theme=dark\]\)\{(--ink[^}]*)\}/)[1]);

const TEXT = ['paper', 'mute', 'dim', 'faint', 'accent', 'sky', 'prose', 'code-inline', 'ok-text', 'sky-text', 'bad', 'ok'];
const BG = ['ink', 'ink-2', 'ink-3'];

export function check() {
  const themes = { dark, 'light (explicit)': { ...dark, ...lightExplicit }, 'light (media query)': { ...dark, ...lightMedia } };
  const failures = [];
  for (const [name, t] of Object.entries(themes)) {
    for (const fg of TEXT) for (const bg of BG) {
      if (!t[fg] || !t[bg]) continue;
      const r = ratio(t[fg], t[bg]);
      if (r < 4.5) failures.push(`${name}: --${fg} ${t[fg]} on --${bg} ${t[bg]} = ${r.toFixed(2)}:1`);
    }
  }
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const f = check();
  if (f.length) { console.error('Contrast below 4.5:1:\n' + f.join('\n')); process.exit(1); }
  console.log('All text token pairs are at least 4.5:1.');
}
