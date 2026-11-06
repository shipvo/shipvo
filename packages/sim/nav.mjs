// Navigation and lifecycle for the simulated phone: back, home, recents, kill. Pure state plus markup.
// The app sees these as AppState changes: react-native-web reads document.visibilityState, so "background" means hidden.

/** Typed error for a navigation action that cannot run now. */
export class NavError extends Error { constructor(code, message) { super(message); this.code = code; } }

/** Where the phone is: the app in front ("app"), the home screen ("home") or the app switcher ("recents"). */
export function createNav() {
  return { where: "app", kills: 0, log: [] };
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
  return `<div class="sf-home" data-part="home-screen" role="region" aria-label="Home screen" hidden><button type="button" class="sf-icon" data-part="app-icon" aria-label="${n}"><b>${n.slice(0, 1).toUpperCase()}</b><span>${n}</span></button><button type="button" class="sf-icon sf-settings-icon" data-part="settings-icon" aria-label="Settings"><b>S</b><span>Settings</span></button></div>`;
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

/** CSS for the home screen and the app switcher. Colours follow the theme (data-theme on the phone body, or on any parent). Dark is the default. */
export function navScreensCss() {
  return [
    `.sf-home,.sf-recents{position:absolute;inset:0;z-index:4;background:linear-gradient(160deg,#1d3557,#0b1320);color:#fff;font-family:system-ui,sans-serif}`,
    `[data-theme="light"] .sf-home{background:linear-gradient(160deg,#dbe7f5,#f4f7fb);color:#111}`,
    `.sf-icon{position:absolute;left:28px;top:70px;width:76px;padding:0;border:0;background:none;color:inherit;display:flex;flex-direction:column;align-items:center;gap:6px;font:600 12px system-ui,sans-serif;cursor:pointer}.sf-icon b{display:flex;width:60px;height:60px;border-radius:16px;background:#f4a261;color:#102030;align-items:center;justify-content:center;font-size:28px}`,
    `.sf-recents{display:flex;align-items:center;justify-content:center;background:#10151cee;color:#fff}[data-theme="light"] .sf-recents{background:#eef1f5ee;color:#111}`,
    `.sf-card{width:230px;height:420px;border-radius:20px;background:#fff;color:#111;border:1px solid #8884;display:flex;flex-direction:column;justify-content:space-between;align-items:center;padding:14px;box-sizing:border-box;transition:transform .2s}[data-theme="dark"] .sf-card{background:#1c232d;color:#fff}.sf-card button{border:0;border-radius:10px;padding:8px 18px;background:#8883;color:inherit;font:600 14px system-ui,sans-serif;cursor:pointer}`,
  ].join("");
}

/** The home screen or switcher as plain markup, shown (not hidden), for a screenshot of a headless session. */
export function awayScreenHtml(where, appName = "App") {
  const inner = (where === "home" ? homeScreenHtml(appName) : recentsHtml(appName)).replace(" hidden>", ">");
  return `<style>${navScreensCss()}</style><div data-theme="dark" style="position:fixed;inset:0;z-index:2147483647">${inner}</div>`;
}
