// What the simulated phone's Settings screen changes in the app's web page: colour scheme, font scale,
// bold text, reduced motion, language and right-to-left. Installed once per window, then `apply()` after each change.
export const FONT_SIZES = { small: 0.85, default: 1, large: 1.3, "extra-large": 1.6 } as const;
export type FontSize = keyof typeof FONT_SIZES;
export const LANGUAGES = ["en", "fr", "ar"] as const;
export type Language = (typeof LANGUAGES)[number];
export type SystemSettings = { darkMode: boolean; fontSize: FontSize; boldText: boolean; reduceMotion: boolean; language: Language; rtl: boolean };

type Live = { media: string; kind: "scheme-dark" | "scheme-light" | "motion"; matches: boolean; fns: Set<(e: unknown) => void>; onchange: ((e: unknown) => void) | null };

export function installSystem(win: any, doc: any, read: () => SystemSettings): () => void {
  if (win.__pnSystem) return win.__pnSystem;
  const lists = new Map<string, Live>();
  const kindOf = (q: string): Live["kind"] | null =>
    /prefers-color-scheme\s*:\s*dark/.test(q) ? "scheme-dark" : /prefers-color-scheme\s*:\s*light/.test(q) ? "scheme-light" : /prefers-reduced-motion\s*:\s*reduce/.test(q) ? "motion" : null;
  const value = (k: Live["kind"], s: SystemSettings) => (k === "scheme-dark" ? s.darkMode : k === "scheme-light" ? !s.darkMode : s.reduceMotion);
  const origMatch = typeof win.matchMedia === "function" ? win.matchMedia.bind(win) : null;
  win.matchMedia = (q: string) => {
    const kind = kindOf(String(q));
    if (!kind) return origMatch ? origMatch(q) : { media: String(q), matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
    let l = lists.get(String(q));
    if (!l) { l = { media: String(q), kind, matches: value(kind, read()), fns: new Set(), onchange: null }; lists.set(String(q), l); }
    const live = l;
    return {
      get media() { return live.media; }, get matches() { return live.matches; },
      get onchange() { return live.onchange; }, set onchange(f) { live.onchange = f; },
      addEventListener: (t: string, f: (e: unknown) => void) => { if (t === "change") live.fns.add(f); },
      removeEventListener: (t: string, f: (e: unknown) => void) => { if (t === "change") live.fns.delete(f); },
      addListener: (f: (e: unknown) => void) => { live.fns.add(f); }, removeListener: (f: (e: unknown) => void) => { live.fns.delete(f); },
      dispatchEvent: () => true,
    };
  };
  // PixelRatio.getFontScale() in the web export reads devicePixelRatio, so the font size step scales it.
  const baseDpr = Number(win.devicePixelRatio) || 1;
  try { Object.defineProperty(win, "devicePixelRatio", { configurable: true, get: () => baseDpr * FONT_SIZES[read().fontSize] }); } catch { /* read-only here */ }
  for (const k of ["language", "languages"]) {
    try { Object.defineProperty(win.navigator, k, { configurable: true, get: () => (k === "language" ? read().language : [read().language]) }); } catch { /* not patchable */ }
  }
  const Intl_ = win.Intl;
  if (Intl_) for (const name of ["NumberFormat", "DateTimeFormat", "Collator", "PluralRules", "ListFormat", "RelativeTimeFormat"]) {
    const Orig = Intl_[name]; if (typeof Orig !== "function") continue;
    const wrap = (a: unknown[]) => (a[0] === undefined ? [read().language, ...a.slice(1)] : a);
    try { Intl_[name] = new Proxy(Orig, { construct: (t, a) => Reflect.construct(t, wrap(a)), apply: (t, _s, a) => (Reflect.construct as any)(t, wrap(a)) }); } catch { /* frozen */ }
  }
  let style: any = null;
  const apply = () => {
    const s = read();
    for (const l of lists.values()) {
      const next = value(l.kind, s); if (next === l.matches) continue;
      l.matches = next; const ev = { matches: next, media: l.media };
      for (const f of [...l.fns]) f(ev); if (l.onchange) l.onchange(ev);
    }
    const root = doc?.documentElement; if (!root) return;
    root.setAttribute("lang", s.language); root.setAttribute("dir", s.rtl ? "rtl" : "ltr");
    if (s.boldText) root.setAttribute("data-pn-bold-text", ""); else root.removeAttribute("data-pn-bold-text");
    if (s.reduceMotion) root.setAttribute("data-pn-reduce-motion", ""); else root.removeAttribute("data-pn-reduce-motion");
    if (!style && doc.head && doc.createElement) { style = doc.createElement("style"); style.textContent = "html[data-pn-bold-text] *{font-weight:700 !important}html[data-pn-reduce-motion] *{animation-duration:.001s !important;transition-duration:.001s !important}"; doc.head.appendChild(style); }
  };
  win.__pnSystem = apply;
  return apply;
}
