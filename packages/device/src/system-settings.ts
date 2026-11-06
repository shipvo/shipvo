// Makes the app see the simulated system settings: Appearance (dark mode), PixelRatio.getFontScale (font size),
// AccessibilityInfo (bold text, reduce motion), I18nManager (RTL) and Intl (language). It patches the app's own
// react-native objects in place, then fires the same events a phone would.
import { Appearance, PixelRatio, AccessibilityInfo, I18nManager, Linking } from "react-native";

export const FONT_SCALES = { small: 0.85, default: 1, large: 1.15, largest: 1.3 } as const;

export function installSystemSettings(dev: { system(): any; openLink?(u: string): Promise<void>; initialUrl?(): string | null; onUrl?(cb: (u: string) => void): () => void }, rn: any = { Appearance, PixelRatio, AccessibilityInfo, I18nManager, Linking }, w: any = globalThis) {
  const cur = () => dev.system();
  const subs: Record<string, Set<(v: any) => void>> = { colorScheme: new Set(), boldTextChanged: new Set(), reduceMotionChanged: new Set() };
  const { Appearance: A, PixelRatio: P, AccessibilityInfo: AI, I18nManager: I } = rn;
  if (A) {
    A.getColorScheme = () => (cur().darkMode ? "dark" : "light");
    A.addChangeListener = (fn: (p: { colorScheme: string }) => void) => { const f = (v: any) => fn({ colorScheme: v }); subs.colorScheme.add(f); return { remove: () => subs.colorScheme.delete(f) }; };
  }
  if (P) P.getFontScale = () => FONT_SCALES[cur().fontSize as keyof typeof FONT_SCALES] ?? 1;
  if (AI) {
    AI.isBoldTextEnabled = async () => cur().boldText;
    AI.isReduceMotionEnabled = async () => cur().reduceMotion;
    const orig = AI.addEventListener?.bind(AI);
    AI.addEventListener = (name: string, fn: (v: any) => void) => {
      if (subs[name] && name !== "colorScheme") { subs[name].add(fn); return { remove: () => subs[name].delete(fn) }; }
      return orig ? orig(name, fn) : { remove() {} };
    };
  }
  // Deep links: Linking.openURL goes through the phone; getInitialURL and the "url" event see links the phone delivers.
  const L = rn.Linking;
  if (L && dev.openLink) {
    L.openURL = (u: string) => dev.openLink!(u);
    L.getInitialURL = async () => dev.initialUrl?.() ?? null;
    const origAdd = L.addEventListener?.bind(L);
    L.addEventListener = (name: string, fn: (e: { url: string }) => void) => {
      if (name !== "url") return origAdd ? origAdd(name, fn) : { remove() {} };
      // Register with the device so the app counts as listening; fall back to the window event without one.
      if (dev.onUrl) { const off = dev.onUrl((u) => fn({ url: u })); return { remove: off }; }
      const h = (e: any) => fn({ url: e.detail }); w.addEventListener?.("pn:url", h);
      return { remove: () => w.removeEventListener?.("pn:url", h) };
    };
  }
  const applyRtl = () => {
    const rtl = !!cur().rtl;
    if (I) { I.getConstants = () => ({ isRTL: rtl, doLeftAndRightSwapInRTL: true, localeIdentifier: cur().language }); try { I.isRTL = rtl; } catch { /* read-only */ } }
    const root = w.document?.documentElement; if (root) { root.setAttribute("dir", rtl ? "rtl" : "ltr"); root.setAttribute("lang", cur().language); }
  };
  // Intl: calls without a locale use the phone's language.
  const lang = () => cur().language;
  for (const name of ["DateTimeFormat", "NumberFormat", "Collator", "PluralRules", "RelativeTimeFormat", "ListFormat"]) {
    const Orig = w.Intl?.[name]; if (!Orig || Orig.__pnWrapped) continue;
    const Wrapped: any = function (this: any, loc?: any, opts?: any) { return new Orig(loc === undefined ? lang() : loc, opts); };
    Wrapped.prototype = Orig.prototype; Wrapped.supportedLocalesOf = Orig.supportedLocalesOf?.bind(Orig); Wrapped.__pnWrapped = true;
    w.Intl[name] = Wrapped;
  }
  try { Object.defineProperty(w.navigator, "language", { configurable: true, get: lang }); Object.defineProperty(w.navigator, "languages", { configurable: true, get: () => [lang()] }); } catch { /* no navigator */ }
  let last = cur(); applyRtl();
  const onChange = () => {
    const n = cur(); const o = last; last = n;
    applyRtl();
    if (n.darkMode !== o.darkMode) subs.colorScheme.forEach((f) => f(n.darkMode ? "dark" : "light"));
    if (n.boldText !== o.boldText) subs.boldTextChanged.forEach((f) => f(n.boldText));
    if (n.reduceMotion !== o.reduceMotion) subs.reduceMotionChanged.forEach((f) => f(n.reduceMotion));
  };
  w.addEventListener?.("pn:system", onChange);
  return { onChange };
}
