// Shipvo logo as vector, rebuilt from the final render: the app-icon tile, the paper plane in four facets, two speed streaks.
// Static colour version, one-colour symbols, and the animated version used on /brand.
const P = {
  A: "645,190 195,445 470,382",   // upper facet
  B: "195,445 470,382 368,488",   // left fold (orange)
  C: "470,382 368,488 470,590",   // lower fold (orange to gold)
  D: "645,190 470,382 470,590",   // right facet
};
const VB = "84 72 640 640";        // square viewBox around the tile with room for the glow stroke
const TILE = { x: 94, y: 82, s: 620, rx: 170 };

const defs = (id) => `<defs>
<linearGradient id="${id}-bg" x1="94" y1="82" x2="714" y2="702" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0E2142"/><stop offset=".55" stop-color="#091328"/><stop offset="1" stop-color="#070C1A"/></linearGradient>
<linearGradient id="${id}-edge" x1="94" y1="702" x2="714" y2="82" gradientUnits="userSpaceOnUse">${"" /* the sweep animates this */}<stop offset="0" stop-color="#FF8A1F"/><stop offset=".34" stop-color="#FFA23A" stop-opacity=".85"/><stop offset=".52" stop-color="#4C7DFF"/><stop offset="1" stop-color="#5FB8FF"/></linearGradient>
<linearGradient id="${id}-a" x1="645" y1="190" x2="195" y2="445" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#DCE7FA"/></linearGradient>
<linearGradient id="${id}-d" x1="645" y1="190" x2="470" y2="590" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#C9DAF6"/></linearGradient>
<linearGradient id="${id}-b" x1="195" y1="445" x2="470" y2="382" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FF7A00"/><stop offset="1" stop-color="#FF9A2E"/></linearGradient>
<linearGradient id="${id}-c" x1="368" y1="488" x2="470" y2="590" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FF8000"/><stop offset="1" stop-color="#FFC21A"/></linearGradient>
<linearGradient id="${id}-s1" x1="172" y1="0" x2="335" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FF8A1F"/><stop offset="1" stop-color="#FFC27A" stop-opacity="0"/></linearGradient>
<filter id="${id}-blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="11"/></filter>
</defs>`;

const facet = (id, k) => `<polygon points="${P[k.toUpperCase()]}" fill="url(#${id}-${k})" stroke="url(#${id}-${k})" stroke-width="1.4" stroke-linejoin="round"/>`;
const plane = (id) => ["a", "b", "c", "d"].map((k) => facet(id, k)).join("");
const streaks = (id) => `<path d="M184 350L326 320" stroke="url(#${id}-s1)" stroke-width="26" stroke-linecap="round" fill="none"/><path d="M148 402L242 382" stroke="url(#${id}-s1)" stroke-width="22" stroke-linecap="round" fill="none" opacity=".9"/>`;
const tile = (id) => `<rect x="${TILE.x}" y="${TILE.y}" width="${TILE.s}" height="${TILE.s}" rx="${TILE.rx}" fill="url(#${id}-bg)"/>`;
const edge = (id, extra = "") => `<rect x="${TILE.x}" y="${TILE.y}" width="${TILE.s}" height="${TILE.s}" rx="${TILE.rx}" fill="none" stroke="url(#${id}-edge)" stroke-width="7"${extra}/>`;
const glow = (id) => `<rect x="${TILE.x}" y="${TILE.y}" width="${TILE.s}" height="${TILE.s}" rx="${TILE.rx}" fill="none" stroke="url(#${id}-edge)" stroke-width="14" opacity=".5" filter="url(#${id}-blur)"/>`;

export function mark(id = "sv") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB}" width="512" height="512" role="img" aria-label="Shipvo">${defs(id)}${glow(id)}${tile(id)}${edge(id)}${streaks(id)}${plane(id)}</svg>`;
}

// One-colour symbol (no tile): the plane and streaks, for placing straight onto a background.
export function symbol(color, id = "sy") {
  const g = (op) => `fill="${color}" fill-opacity="${op}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="120 150 560 460" width="560" height="460" role="img" aria-label="Shipvo"><polygon points="${P.A}" ${g(1)}/><polygon points="${P.D}" ${g(0.86)}/><polygon points="${P.B}" ${g(0.62)}/><polygon points="${P.C}" ${g(0.74)}/><path d="M184 350L326 320" stroke="${color}" stroke-opacity=".6" stroke-width="26" stroke-linecap="round" fill="none"/><path d="M148 402L242 382" stroke="${color}" stroke-opacity=".5" stroke-width="22" stroke-linecap="round" fill="none"/></svg>`;
}

// Animated: the border draws itself, the plane launches in, the streaks stream, then it idles (plane drifts, edge light travels).
export function animated(id = "sva") {
  const css = `
.${id}-plane{transform-box:view-box;animation:${id}-in .9s cubic-bezier(.2,.8,.2,1) .55s both,${id}-idle 5.5s ease-in-out 1.6s infinite}
.${id}-s{animation:${id}-stream 2.6s ease-in-out 1.4s infinite both;transform-box:fill-box}.${id}-s2{animation-delay:1.9s}
.${id}-draw{stroke-dasharray:1;stroke-dashoffset:1;animation:${id}-draw 1.5s cubic-bezier(.5,0,.2,1) .05s forwards}
.${id}-fill{animation:${id}-fade .6s ease-out both}
.${id}-glow{animation:${id}-fade 1.2s ease-out .6s both,${id}-pulse 5.5s ease-in-out 2s infinite}
@keyframes ${id}-draw{to{stroke-dashoffset:0}}
@keyframes ${id}-fade{from{opacity:0}}
@keyframes ${id}-in{from{opacity:0;transform:translate(-110px,110px) scale(.82)}60%{opacity:1}to{opacity:1;transform:none}}
@keyframes ${id}-idle{0%,100%{transform:translate(0,0) rotate(0)}50%{transform:translate(9px,-9px) rotate(-1.2deg)}}
@keyframes ${id}-stream{0%{opacity:0;transform:translateX(-26px) scaleX(.55)}25%{opacity:1}70%{opacity:1;transform:translateX(6px) scaleX(1)}100%{opacity:0;transform:translateX(18px) scaleX(.8)}}
@keyframes ${id}-pulse{0%,100%{opacity:.4}50%{opacity:.75}}
@media (prefers-reduced-motion:reduce){.${id}-plane,.${id}-s,.${id}-draw,.${id}-fill,.${id}-glow{animation:none!important;stroke-dashoffset:0;opacity:1}.${id}-glow{opacity:.5}}`;
  const d = defs(id).replace(`<stop offset="0" stop-color="#FF8A1F"/><stop offset=".34"`, `<stop offset="0" stop-color="#FF8A1F"/><stop offset=".34"`)
    .replace(`gradientUnits="userSpaceOnUse">${""}<stop offset="0" stop-color="#FF8A1F"/>`, `gradientUnits="userSpaceOnUse"><animateTransform attributeName="gradientTransform" type="rotate" from="0 404 392" to="360 404 392" dur="14s" begin="1.6s" repeatCount="indefinite"/><stop offset="0" stop-color="#FF8A1F"/>`);
  const edgeRect = `<rect pathLength="1" class="${id}-draw" x="${TILE.x}" y="${TILE.y}" width="${TILE.s}" height="${TILE.s}" rx="${TILE.rx}" fill="none" stroke="url(#${id}-edge)" stroke-width="7"/>`;
  const glowRect = `<rect class="${id}-glow" x="${TILE.x}" y="${TILE.y}" width="${TILE.s}" height="${TILE.s}" rx="${TILE.rx}" fill="none" stroke="url(#${id}-edge)" stroke-width="14" filter="url(#${id}-blur)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB}" width="512" height="512" role="img" aria-label="Shipvo"><style>${css}</style>${d}${glowRect}<g class="${id}-fill">${tile(id)}</g>${edgeRect}<g class="${id}-s">${`<path d="M184 350L326 320" stroke="url(#${id}-s1)" stroke-width="26" stroke-linecap="round" fill="none"/>`}</g><g class="${id}-s ${id}-s2"><path d="M148 402L242 382" stroke="url(#${id}-s1)" stroke-width="22" stroke-linecap="round" fill="none" opacity=".9"/></g><g class="${id}-plane">${plane(id)}</g></svg>`;
}
