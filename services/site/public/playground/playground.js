// shipvo.dev/playground: a sample app on an Android or iOS phone, a settings bar and a feature sidebar with deep links.
import { FEATURES, featureFromHash, settingsFromSearch, searchFromSettings, phoneSrc, appStyle } from "./core.js";

const $ = (id) => document.getElementById(id);
let settings = settingsFromSearch(location.search);
const frame = $("pg-phone");

function applyToApp() {
  try {
    const app = frame.contentWindow.frames[0];
    const d = app && app.document;
    if (!d || !d.documentElement) return;
    const a = appStyle(settings);
    d.documentElement.dir = a.dir;
    d.documentElement.style.colorScheme = a.colorScheme;
    d.documentElement.setAttribute("data-color-scheme", a.colorScheme);
    d.body.style.zoom = a.zoom;
  } catch { /* the app is not loaded yet; the load handler runs this again */ }
}

function paintControls() {
  for (const b of document.querySelectorAll("[data-platform]")) b.setAttribute("aria-pressed", String(b.dataset.platform === settings.platform));
  for (const k of ["dark", "large", "rtl"]) $("pg-" + k).setAttribute("aria-pressed", String(settings[k]));
}

function load() {
  const src = phoneSrc(settings.platform);
  if (!frame.getAttribute("src") || !frame.getAttribute("src").endsWith(src)) frame.src = src;
  frame.title = (settings.platform === "ios" ? "iOS" : "Android") + " phone running the sample app";
  paintControls();
  applyToApp();
}

function save() {
  history.replaceState(null, "", location.pathname + searchFromSettings(settings) + location.hash);
  load();
}

function showFeature() {
  const id = featureFromHash(location.hash);
  for (const f of FEATURES) {
    const link = document.querySelector(`[data-feature="${f.id}"]`);
    link.setAttribute("aria-current", f.id === id ? "page" : "false");
    $("pg-panel-" + f.id).hidden = f.id !== id;
  }
}

for (const b of document.querySelectorAll("[data-platform]")) b.addEventListener("click", () => { settings = { ...settings, platform: b.dataset.platform }; save(); });
for (const k of ["dark", "large", "rtl"]) $("pg-" + k).addEventListener("click", () => { settings = { ...settings, [k]: !settings[k] }; save(); });
frame.addEventListener("load", () => {
  // The app inside the phone loads after the phone page does, so try for a few seconds.
  let n = 0; const t = setInterval(() => { applyToApp(); if (++n > 40) clearInterval(t); }, 250);
});
addEventListener("hashchange", showFeature);
showFeature();
load();
