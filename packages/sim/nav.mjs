// Navigation and lifecycle for the simulated phone: back, home, recents, kill. Pure state plus markup.
// The app sees these as AppState changes: react-native-web reads document.visibilityState, so "background" means hidden.

/** Typed error for a navigation action that cannot run now. */
export class NavError extends Error { constructor(code, message) { super(message); this.code = code; } }

/** Where the phone is: the app in front ("app"), the home screen ("home") or the app switcher ("recents"). */
export function createNav(navStyle = "gesture") {
  return { where: "app", navStyle, kills: 0, log: [] };
}

const note = (st, name) => { st.log.push({ at: Date.now(), name, source: "simulated" }); };

/** Home: app to background. From recents it also goes home. Returns the AppState the app should see ("background"), or null if nothing changes. */
export function pressHome(st) {
  const was = st.where; st.where = "home"; note(st, "press_home");
  return was === "app" ? "background" : null;
}

/** Recents: the app switcher card. From the app this backgrounds it. */
export function openRecents(st) {
  const was = st.where; st.where = "recents"; note(st, "open_recents");
  return was === "app" ? "background" : null;
}

/** Tap the app icon or its recents card. Returns "active" when the app comes back. Throws if the app is already in front. */
export function resume(st) {
  if (st.where === "app") throw new NavError("app_in_foreground", "the app is already in front");
  st.where = "app"; note(st, "resume"); return "active";
}

/** Swipe the recents card away. The app is killed; the next open is a cold start. Throws unless the switcher is open. */
export function killApp(st) {
  if (st.where !== "recents") throw new NavError("recents_not_open", "open the app switcher first (open_recents), then kill_app");
  st.where = "home"; st.kills++; note(st, "kill_app"); return st;
}

/** "gesture" or "buttons" (Android). */
export function setNavStyle(st, style) {
  if (style !== "gesture" && style !== "buttons") throw new NavError("bad_nav_style", 'navigation style is "gesture" or "buttons"');
  st.navStyle = style; return st;
}

/** Throws app_not_foreground while the home screen or the app switcher is showing, so no input reaches a backgrounded app. */
export function assertForeground(st) {
  if (st.where !== "app") throw new NavError("app_not_foreground", `the phone is on the ${st.where === "home" ? "home screen" : "app switcher"}, so nothing was sent to the app. Open the app first (resume_app).`);
}

/**
 * Classify a swipe on the bottom bar or the left edge.
 * s: { skin, fromEdge: "bottom"|"left"|null, dx, dy, ms } (dy negative is up).
 * Returns "home", "recents", "switch-left", "switch-right", "back" or null.
 */
export function classifySwipe({ skin = "android", fromEdge = null, dx = 0, dy = 0, ms = 0 } = {}) {
  if (fromEdge === "left" && dx > 60 && Math.abs(dy) < 80) return "back";
  if (fromEdge !== "bottom") return null;
  if (dy < -60 && Math.abs(dx) < Math.abs(dy)) return ms >= 400 ? "recents" : "home";
  if (skin === "ios" && Math.abs(dx) > 60 && Math.abs(dy) < 40) return dx > 0 ? "switch-right" : "switch-left";
  return null;
}

/** Runs in the app page. Sets what AppState reads and fires the event. */
export function setVisibilityInPage(state) {
  const hidden = state === "background";
  try {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  } catch {}
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Home screen markup: the app icon. Hidden until the phone goes home. */
export function homeScreenHtml(appName = "App") {
  const n = String(appName).replace(/[<>&"'\\]/g, "").slice(0, 40) || "App";
  return `<div class="sf-home" data-part="home-screen" role="region" aria-label="Home screen" hidden><button type="button" class="sf-icon" data-part="app-icon" aria-label="${n}"><b>${n.slice(0, 1).toUpperCase()}</b><span>${n}</span></button></div>`;
}

/** App switcher markup: one card for the app. Click the card to open it, the close button (or swipe it up) to kill the app. */
export function recentsHtml(appName = "App") {
  const n = String(appName).replace(/[<>&"'\\]/g, "").slice(0, 40) || "App";
  return `<div class="sf-recents" data-part="recents" role="region" aria-label="Recent apps" hidden><div class="sf-card" data-part="recents-card"><button type="button" data-part="recents-open" aria-label="Open ${n}">${n}</button><button type="button" data-part="recents-close" aria-label="Close ${n}">Close</button></div></div>`;
}

/** The three buttons of Android 3-button navigation. */
export function navButtonsHtml() {
  return `<div class="sf-navbtns" data-part="nav-buttons" hidden><button type="button" data-part="nav-back" aria-label="Back">◀</button><button type="button" data-part="nav-home" aria-label="Home">●</button><button type="button" data-part="nav-recents" aria-label="Recents">■</button></div>`;
}
