#!/usr/bin/env node
// Cloud device driver: the same commands (screen, tap, type, scroll) on LambdaTest real phones, emulators and
// iOS simulators over Appium (plain WebDriver over fetch, no dependencies). Used by sim/parity-cloud.mjs.
// LambdaTest by default; a local Appium server (e.g. on a macOS runner) when APPIUM_HUB is set.
const HUB = process.env.APPIUM_HUB || "https://mobile-hub.lambdatest.com/wd/hub";
const auth = () => process.env.APPIUM_HUB ? "" : "Basic " + Buffer.from(`${process.env.LT_USER}:${process.env.LT_KEY}`).toString("base64");

async function wd(method, path, body) {
  const headers = { "content-type": "application/json" }; const a = auth(); if (a) headers.authorization = a;
  const r = await fetch(HUB + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.value?.error) throw new Error(`${method} ${path}: ${r.status} ${j.value?.error ?? ""} ${(j.value?.message ?? "").split("\n")[0]}`);
  return j.value;
}

export async function startSession(caps) {
  const always = process.env.APPIUM_LOCAL
    ? { platformName: "iOS", "appium:automationName": "XCUITest", "appium:udid": caps.udid, "appium:bundleId": "dev.purenative.tide", "appium:noReset": true, "appium:newCommandTimeout": 300, "appium:wdaLaunchTimeout": 240000 }
    : { "lt:options": caps };
  const v = await wd("POST", "/session", { capabilities: { alwaysMatch: always } });
  return { id: v.sessionId, platform: String(caps.platformName).toLowerCase() };
}
export const endSession = (s, status = "passed") => wd("DELETE", `/session/${s.id}`).catch(() => {});

/** Parse page source into the same element list as the other drivers. */
export async function elements(s) {
  const xml = await wd("GET", `/session/${s.id}/source`);
  const out = [];
  for (const m of xml.matchAll(/<([\w.]+) ([^>]*?)\/?>/g)) {
    const tag = m[1]; const a = Object.fromEntries([...m[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], x[2].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#10;/g, " ")]));
    let role, label;
    if (s.platform === "ios") {
      // Platform chrome (scroll indicators, keyboard keys) is marked not accessible: not part of the app.
      if (a.accessible === "false" && !tag.endsWith("Button") && !tag.endsWith("StaticText") && !tag.endsWith("TextField")) continue;
      if (/Keyboard|Key$/.test(tag)) continue;
      label = (a.label || a.name || a.value || "").trim();
      role = tag.endsWith("Button") ? "button" : tag.endsWith("TextField") ? "textbox" : tag.endsWith("StaticText") ? "text" : tag.endsWith("Other") && a.accessible === "true" && label ? "text" : null;
      if (/\bButton\b/.test(a.traits ?? "")) role = "button";
      if (/\bHeader\b/.test(a.traits ?? "")) role = "heading";
      if (a.value === "radio button") role = "radio";   // React Native accessibilityRole="radio" on iOS
    } else {
      label = (a["content-desc"] || a.text || "").trim();
      const cls = (a.class || tag).split(".").pop();
      role = cls === "EditText" ? "textbox" : a.clickable === "true" || cls === "Button" ? "button" : label ? "text" : null;
    }
    if (!role || !label) continue;
    out.push({ role, label, disabled: a.enabled === "false" });
  }
  return out;
}

async function find(s, label) {
  const using = "accessibility id";
  const els = await wd("POST", `/session/${s.id}/elements`, { using, value: label });
  if (els?.length) return Object.values(els[0])[0];
  // fall back to a partial match
  const sel = s.platform === "ios" ? { using: "-ios predicate string", value: `label BEGINSWITH "${label.replace(/"/g, '\\"')}"` }
    : { using: "-android uiautomator", value: `new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().descriptionStartsWith("${label.replace(/"/g, '\\"')}"))` };
  const e2 = await wd("POST", `/session/${s.id}/elements`, sel).catch(() => []);
  if (e2?.length) return Object.values(e2[0])[0];
  throw new Error(`no element "${label}"`);
}
async function scroll(s, dir = "down") {
  if (s.platform === "ios") return wd("POST", `/session/${s.id}/execute/sync`, { script: "mobile: swipe", args: [{ direction: dir === "down" ? "up" : "down" }] }).catch(() => {});
  return wd("POST", `/session/${s.id}/execute/sync`, { script: "mobile: scrollGesture", args: [{ left: 100, top: 300, width: 600, height: 1200, direction: dir, percent: 0.8 }] }).catch(() => {});
}
export async function tap(s, label) {
  for (let i = 0; i < 6; i++) {
    try { const id = await find(s, label); await wd("POST", `/session/${s.id}/element/${id}/click`, {}); await new Promise((r) => setTimeout(r, 900)); return; }
    catch (e) { if (i === 5) throw e; await scroll(s, "down"); }
  }
}
export async function type(s, label, text) {
  const id = await find(s, label);
  await wd("POST", `/session/${s.id}/element/${id}/click`, {});
  await wd("POST", `/session/${s.id}/element/${id}/value`, { text });
  // A person closes the keyboard before tapping what it covers.
  if (s.platform === "ios") await wd("POST", `/session/${s.id}/execute/sync`, { script: "mobile: hideKeyboard", args: [{ keys: ["return", "Return", "done", "Done"] }] }).catch(() => {});
  else await wd("POST", `/session/${s.id}/appium/device/hide_keyboard`, {}).catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
}
export const source = (s) => wd("GET", `/session/${s.id}/source`);
/** Whole screen, like the simulator's full page: scroll through and collect. */
export async function fullScreen(s) {
  const seen = new Map(); let stale = 0;
  for (let i = 0; i < 6 && stale < 2; i++) { const before = seen.size; for (const e of await elements(s)) seen.set(`${e.role}|${e.label}`, e); stale = seen.size === before ? stale + 1 : 0; await scroll(s, "down"); }
  for (let i = 0; i < 6; i++) await scroll(s, "up");
  return [...seen.values()];
}
