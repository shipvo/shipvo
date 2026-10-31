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
    ? { platformName: "iOS", "appium:automationName": "XCUITest", "appium:udid": caps.udid, "appium:bundleId": "dev.shipvo.tide", "appium:noReset": true, "appium:newCommandTimeout": 300, "appium:wdaLaunchTimeout": 240000 }
    : { "lt:options": caps };
  const v = await wd("POST", "/session", { capabilities: { alwaysMatch: always } });
  return { id: v.sessionId, platform: String(caps.platformName).toLowerCase() };
}
export const endSession = (s, status = "passed") => wd("DELETE", `/session/${s.id}`).catch(() => {});

/** Parse page source into the same element list as the other drivers. */
export async function elements(s) {
  let xml = await wd("GET", `/session/${s.id}/source`);
  // The on-screen keyboard is the system's, not the app's.
  xml = xml.replace(/<XCUIElementTypeKeyboard[\s\S]*?<\/XCUIElementTypeKeyboard>/g, "");
  const out = [];
  for (const m of xml.matchAll(/<([\w.]+) ([^>]*?)\/?>/g)) {
    const tag = m[1]; const a = Object.fromEntries([...m[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], x[2].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#10;/g, " ")]));
    let role, label;
    if (s.platform === "ios") {
      // Platform chrome (scroll indicators, keyboard keys) is marked not accessible: not part of the app.
      if (a.accessible === "false" && !tag.endsWith("Button") && !tag.endsWith("StaticText") && !tag.endsWith("TextField")) continue;
      if (/Keyboard|Key$/.test(tag)) continue;
      // What is not on screen is not on screen: items scrolled out of a horizontal rail report visible="false".
      if (a.visible === "false") continue;
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
export async function tap(s, label, { once = false } = {}) {
  for (let i = 0; i < (once ? 1 : 6); i++) {
    try { const id = await find(s, label); await wd("POST", `/session/${s.id}/element/${id}/click`, {}); await new Promise((r) => setTimeout(r, 900)); return; }
    catch (e) { if (once || i === 5) throw e; await scroll(s, "down"); }
  }
}
// A heading can share a field's label ("Promo code"): look for the text field itself first.
async function findField(s, label) {
  const q = label.replace(/"/g, '\\"');
  const sel = s.platform === "ios" ? { using: "-ios predicate string", value: `label == "${q}" AND type IN {"XCUIElementTypeTextField", "XCUIElementTypeSecureTextField", "XCUIElementTypeTextView"}` }
    : { using: "-android uiautomator", value: `new UiSelector().className("android.widget.EditText").description("${q}")` };
  const els = await wd("POST", `/session/${s.id}/elements`, sel).catch(() => []);
  return els?.length ? Object.values(els[0])[0] : find(s, label);
}
export async function type(s, label, text) {
  let id;
  for (let i = 0; i < 4 && !id; i++) { try { id = await findField(s, label); } catch (e) { if (i === 3) throw e; await scroll(s, "down"); } }
  await wd("POST", `/session/${s.id}/element/${id}/click`, {});
  await new Promise((r) => setTimeout(r, 500)); // let the keyboard settle: typing into a moving field drops characters
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await wd("POST", `/session/${s.id}/element/${id}/clear`, {}).catch(() => {});
    await wd("POST", `/session/${s.id}/element/${id}/value`, { text });
    const v = await wd("GET", `/session/${s.id}/element/${id}/attribute/value`).catch(() => null);
    if (v == null || String(v).replace(/\s/g, "") === text.replace(/\s/g, "") || (s.platform === "ios" && /secure|•/.test(String(v)))) break;
  }
  // A person closes the keyboard before tapping what it covers.
  if (s.platform === "ios") {
    await wd("POST", `/session/${s.id}/execute/sync`, { script: "mobile: hideKeyboard", args: [{ keys: ["return", "Return", "done", "Done", "search", "Search", "go", "Go"] }] }).catch(() => {});
    // A number pad has no return key: drag the page down a little, as a person would, which closes it.
    if (await wd("GET", `/session/${s.id}/appium/device/is_keyboard_shown`).catch(() => false))
      await wd("POST", `/session/${s.id}/execute/sync`, { script: "mobile: dragFromToForDuration", args: [{ duration: 0.3, fromX: 200, fromY: 260, toX: 200, toY: 420 }] }).catch(() => {});
  }
  else await wd("POST", `/session/${s.id}/appium/device/hide_keyboard`, {}).catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
}
export const source = (s) => wd("GET", `/session/${s.id}/source`);
/** Whole screen, like the simulator's full page: scroll through and collect. */
export async function fullScreen(s) {
  // A keyboard left open (number pad after a PIN) is not part of the screen: close it first, as a person would.
  for (let i = 0; i < 3 && s.platform === "ios" && (await wd("GET", `/session/${s.id}/appium/device/is_keyboard_shown`).catch(() => false)); i++) {
    // A number pad has no Done key: tap empty header space (centre top, no control there), then drag, as a person would.
    await wd("POST", `/session/${s.id}/execute/sync`, { script: "mobile: tap", args: [{ x: 196, y: 110 }] }).catch(() => {});
    await wd("POST", `/session/${s.id}/execute/sync`, { script: "mobile: dragFromToForDuration", args: [{ duration: 0.3, fromX: 200, fromY: 300, toX: 200, toY: 500 }] }).catch(() => {});
    await new Promise((r) => setTimeout(r, 600));
  }
  const seen = new Map(); let stale = 0;
  for (let i = 0; i < 6 && stale < 2; i++) { const before = seen.size; for (const e of await elements(s)) seen.set(`${e.role}|${e.label}`, e); stale = seen.size === before ? stale + 1 : 0; await scroll(s, "down"); }
  for (let i = 0; i < 6; i++) await scroll(s, "up");
  return [...seen.values()];
}
