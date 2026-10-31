// The Shipvo corona: an animated SVG of one release going out to many devices (orange pulses) and agents opening the
// same release (blue pulses). Original artwork: seeded, so the same picture is built every time. Decorative only.
import { readFileSync, existsSync } from "node:fs";

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const f = (n) => (Math.round(n * 10) / 10).toString();

export function corona({ logoHref, id = "cor", standalone = false, threads = 168, pulses = 34 } = {}) {
  const R = rng(20261031), C = 500, T = 10;            // C: centre, T: seconds for one sweep around the circle
  const rays = [];
  for (let i = 0; i < threads; i++) {
    const a = (i / threads) * Math.PI * 2 + (R() - 0.5) * 0.06 * (Math.PI * 2 / 12);
    const d = 175 + Math.pow(R(), 0.78) * 300;           // most threads reach far; a few stop near the tile
    rays.push({ a, d, x: C + Math.cos(a) * d, y: C + Math.sin(a) * d, tier: d < 300 ? 0 : d < 400 ? 1 : 2, dot: 1.6 + R() * 1.9 });
  }
  const frac = (a) => (((a / (Math.PI * 2)) % 1) + 1) % 1;
  const lines = rays.map((r) => `<path class="th t${r.tier}" style="animation-delay:${f(-frac(r.a) * T)}s" d="M${C} ${C}L${f(r.x)} ${f(r.y)}"/>`).join("");
  const dots = rays.map((r) => `<circle class="nd" style="animation-delay:${f(-frac(r.a) * T)}s" cx="${f(r.x)}" cy="${f(r.y)}" r="${f(r.dot)}"/>`).join("");
  // pulses ride on a subset of threads: orange outward (a release ships), blue inward (an agent opens it)
  const picks = [...rays.keys()].sort(() => R() - 0.5).slice(0, pulses);
  let pl = "", hits = "";
  picks.forEach((k, j) => {
    const r = rays[k], out = j % 4 !== 3, dur = 3.2 + R() * 3.4, delay = -R() * 9;
    const d = out ? `M${C} ${C}L${f(r.x)} ${f(r.y)}` : `M${f(r.x)} ${f(r.y)}L${C} ${C}`;
    pl += `<path class="pl ${out ? "go" : "ret"}" pathLength="1" style="animation-duration:${f(dur)}s;animation-delay:${f(delay)}s" d="${d}"/>`;
    if (out) hits += `<circle class="hit" style="animation-duration:${f(dur)}s;animation-delay:${f(delay)}s" cx="${f(r.x)}" cy="${f(r.y)}" r="${f(r.dot + 3.4)}"/>`;
  });
  const css = `
.${id}{--thread:#B6BDCB;--node:#B6BDCB;--go:#FF9A2E;--ret:#5FB8FF;--tile-glow:rgba(255,154,46,.5)}
.${id} .th{fill:none;stroke:var(--thread);stroke-linecap:round;animation:${id}-sweep ${T}s linear infinite}
.${id} .t0{stroke-width:.8;--o:.16}.${id} .t1{stroke-width:1;--o:.2}.${id} .t2{stroke-width:1.2;--o:.26}
.${id} .nd{fill:var(--node);animation:${id}-node ${T}s linear infinite}
.${id} .pl{fill:none;stroke-width:2.2;stroke-linecap:round;stroke-dasharray:.07 3;stroke-dashoffset:.07;animation:${id}-run 4s cubic-bezier(.45,.05,.35,1) infinite}
.${id} .go{stroke:var(--go);filter:drop-shadow(0 0 3px var(--go))}.${id} .ret{stroke:var(--ret);filter:drop-shadow(0 0 3px var(--ret))}
.${id} .hit{fill:none;stroke:var(--go);stroke-width:1.4;opacity:0;transform-box:fill-box;transform-origin:center;animation:${id}-hit 4s ease-out infinite}
.${id} .ripple{fill:none;stroke:var(--go);stroke-width:1.5;opacity:0;vector-effect:non-scaling-stroke;transform-origin:${C}px ${C}px;animation:${id}-ripple 9s ease-out infinite}
.${id} .glow{fill:var(--tile-glow);transform-origin:${C}px ${C}px;animation:${id}-breathe 6s ease-in-out infinite}
@keyframes ${id}-sweep{0%{opacity:calc(var(--o)*.5)}5%{opacity:1}24%{opacity:calc(var(--o)*1.4)}100%{opacity:calc(var(--o)*.5)}}
@keyframes ${id}-node{0%{opacity:.25}5%{opacity:1}24%{opacity:.6}100%{opacity:.25}}
@keyframes ${id}-run{0%{stroke-dashoffset:.07}55%,100%{stroke-dashoffset:-1.02}}
@keyframes ${id}-hit{0%,52%{transform:scale(.6);opacity:0}58%{transform:scale(1);opacity:.95}78%,100%{transform:scale(2.6);opacity:0}}
@keyframes ${id}-ripple{0%{transform:scale(.34);opacity:.55}70%,100%{transform:scale(1);opacity:0}}
@keyframes ${id}-breathe{0%,100%{opacity:.16;transform:scale(.94)}50%{opacity:.34;transform:scale(1.05)}}
@media (prefers-reduced-motion:reduce){.${id} *{animation:none!important}.${id} .th{opacity:var(--o)}.${id} .nd{opacity:.5}.${id} .pl,.${id} .hit,.${id} .ripple{display:none}.${id} .glow{opacity:.22}}`;
  const light = standalone ? `@media (prefers-color-scheme:light){.${id}{--thread:#454C5B;--node:#454C5B;--go:#E8780A;--ret:#0B6FC4;--tile-glow:rgba(232,120,10,.4)}}` : "";
  const tile = 196, img = Math.round(tile / 0.8), tx = C - img / 2, cx0 = C - tile / 2;
  return `<svg class="${id}" viewBox="0 0 1000 1000" role="img" aria-label="Illustration: one Shipvo release going out to many phones, with agents opening the same release" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><style>${css}${light}</style>`
    + `<defs><radialGradient id="${id}-fade" cx="500" cy="500" r="500" gradientUnits="userSpaceOnUse"><stop offset=".62" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><mask id="${id}-m"><rect width="1000" height="1000" fill="url(#${id}-fade)"/></mask><clipPath id="${id}-tile"><rect x="${cx0}" y="${cx0}" width="${tile}" height="${tile}" rx="${Math.round(tile * 0.225)}"/></clipPath></defs>`
    + `<g mask="url(#${id}-m)">${lines}${dots}${pl}${hits}</g>`
    + `<circle class="ripple" cx="${C}" cy="${C}" r="470"/><circle class="ripple" style="animation-delay:-3s" cx="${C}" cy="${C}" r="470"/><circle class="ripple" style="animation-delay:-6s" cx="${C}" cy="${C}" r="470"/>`
    + `<circle class="glow" cx="${C}" cy="${C}" r="200"/>`
    + `<image clip-path="url(#${id}-tile)" href="${logoHref}" xlink:href="${logoHref}" x="${tx}" y="${tx}" width="${img}" height="${img}"/></svg>`;
}
