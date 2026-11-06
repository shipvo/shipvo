// Makes the app see the simulated system settings: Appearance (dark mode), PixelRatio.getFontScale (font size),
// AccessibilityInfo (bold text, reduce motion), I18nManager (RTL) and Intl (language). It patches the app's own
// react-native objects in place, then fires the same events a phone would.
import { Appearance, PixelRatio, AccessibilityInfo, I18nManager, Dimensions } from "react-native";

export const FONT_SCALES = { small: 0.85, default: 1, large: 1.15, largest: 1.3 } as const;

export function installSystemSettings(dev: { system(): any }, rn: any = { Appearance, PixelRatio, AccessibilityInfo, I18nManager, Dimensions }, w: any = globalThis) {
  const cur = () => dev.system();
  const subs: Record<string, Set<(v: any) => void>> = { colorScheme: new Set(), boldTextChanged: new Set(), reduceMotionChanged: new Set(), dimensions: new Set() };
  const { Appearance: A, PixelRatio: P, AccessibilityInfo: AI, I18nManager: I, Dimensions: D } = rn;
  if (A) {
    A.getColorScheme = () => (cur().darkMode ? "dark" : "light");
    A.addChangeListener = (fn: (p: { colorScheme: string }) => void) => { const f = (v: any) => fn({ colorScheme: v }); subs.colorScheme.add(f); return { remove: () => subs.colorScheme.delete(f) }; };
  }
  if (P) P.getFontScale = () => FONT_SCALES[cur().fontSize as keyof typeof FONT_SCALES] ?? 1;
  const scale = () => FONT_SCALES[cur().fontSize as keyof typeof FONT_SCALES] ?? 1;
  // A text size change reaches the open screen the way it does on a phone: Dimensions reports the new fontScale and fires "change".
  if (D) {
    const get = D.get?.bind(D); const add = D.addEventListener?.bind(D);
    const dims = () => ({ window: { ...get?.("window"), fontScale: scale() }, screen: { ...get?.("screen"), fontScale: scale() } });
    if (get) D.get = (k: string) => ({ ...get(k), fontScale: scale() });
    D.addEventListener = (name: string, fn: (v: any) => void) => {
      if (name === "change") { subs.dimensions.add(fn); return { remove: () => subs.dimensions.delete(fn) }; }
      return add ? add(name, fn) : { remove() {} };
    };
    (subs.dimensions as any).emit = () => { const d = dims(); subs.dimensions.forEach((f) => f(d)); };
  }
  if (AI) {
    AI.isBoldTextEnabled = async () => cur().boldText;
    AI.isReduceMotionEnabled = async () => cur().reduceMotion;
    const orig = AI.addEventListener?.bind(AI);
    AI.addEventListener = (name: string, fn: (v: any) => void) => {
      if (subs[name] && name !== "colorScheme") { subs[name].add(fn); return { remove: () => subs[name].delete(fn) }; }
      return orig ? orig(name, fn) : { remove() {} };
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
    if (n.fontSize !== o.fontSize) (subs.dimensions as any).emit?.();
    if (n.boldText !== o.boldText) subs.boldTextChanged.forEach((f) => f(n.boldText));
    if (n.reduceMotion !== o.reduceMotion) subs.reduceMotionChanged.forEach((f) => f(n.reduceMotion));
  };
  w.addEventListener?.("pn:system", onChange);
  return { onChange };
}
