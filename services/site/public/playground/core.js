// Pure helpers for /playground/: the feature list, the hash and the phone settings. No DOM here, so tests can import it.
export const FEATURES = [
  { id: "app", title: "Sample app", text: "A chess app running on an Android or iOS phone. Tap it, or switch the phone, theme, text size and direction above.", doc: "/docs/agents/" },
  { id: "device", title: "Device API", text: "Camera, location, biometrics, payments, notifications and airplane mode, set live on the phone.", doc: "/docs/device-api/" },
  { id: "ota", title: "Over-the-air updates", text: "Signed updates, staged rollouts and crash-loop rollback.", doc: "/docs/getting-started/#5-publish-over-the-air" },
  { id: "agent", title: "Agent tools", text: "Drive the phone with tap, type, screen and device_log, the same tools an assistant gets over MCP.", doc: "/docs/mcp/" },
  { id: "phones", title: "Many phones", text: "Run several phones side by side and share the setup as a link.", doc: "/products/simulators/" },
];
export const DEFAULTS = Object.freeze({ platform: "android", dark: false, large: false, rtl: false });
const ids = FEATURES.map((f) => f.id);

// "#ota" -> "ota". Unknown or empty hashes open the first feature.
export function featureFromHash(hash) {
  const id = String(hash || "").replace(/^#/, "");
  return ids.includes(id) ? id : ids[0];
}

// "?platform=ios&dark=1" -> settings. Anything unknown falls back to the default, so a shared link never breaks the page.
export function settingsFromSearch(search) {
  const q = new URLSearchParams(search || "");
  const on = (k) => q.get(k) === "1";
  return { platform: q.get("platform") === "ios" ? "ios" : "android", dark: on("dark"), large: on("large"), rtl: on("rtl") };
}

// Only settings that differ from the default go into the link.
export function searchFromSettings(s) {
  const q = new URLSearchParams();
  if (s.platform === "ios") q.set("platform", "ios");
  for (const k of ["dark", "large", "rtl"]) if (s[k]) q.set(k, "1");
  const t = q.toString();
  return t ? "?" + t : "";
}

export const phoneSrc = (platform) => `/demos/chess/phone-${platform === "ios" ? "ios" : "android"}.html`;

// What to apply inside the app document for the current settings.
export function appStyle(s) {
  return { dir: s.rtl ? "rtl" : "ltr", colorScheme: s.dark ? "dark" : "light", zoom: s.large ? "1.3" : "1" };
}
