#!/usr/bin/env node
// Parity against LambdaTest cloud devices: our simulator vs an iOS Simulator or a real Android phone.
//   LT_USER=... LT_KEY=... node sim/parity-cloud.mjs --lane ios|android-real --app lt://APP... [--sim http://localhost:4545]
import { writeFileSync } from "node:fs";
import * as cloud from "./appium.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const LANE = arg("lane", "ios"), APP = arg("app"), SIM = arg("sim", "http://localhost:4545");
const FLOW = [
  { name: "Home" }, { tap: "Chrome Spoon 30 g", name: "Product" }, { tap: "Increase quantity" }, { tap: "Add 2 to cart", name: "Added" },
  { tap: "Open cart", name: "Cart" }, { tap: "Choose delivery and pay", name: "Checkout" }, { tap: "Friday 14:00" },
  { type: "Delivery address", text: "Bonapriso Douala" }, { tap: "Place order" },
  { tap: "Allow", exact: true, optional: true, name: "Order placed" },   // iOS asks to send notifications after the first order; a person taps Allow, then sees the order
  { wait: 6000 },                                   // the "order confirmed" banner clears
  // Flow B: search, promo code, shop pickup, mobile money.
  { tap: "Back to shop", flow: "B" }, { tap: "Open search", name: "Search" }, { type: "Search products", text: "popper", name: "Search results" },
  { tap: "Surface Popper 9 cm", name: "Product B" }, { tap: "Increase quantity" }, { tap: "Increase quantity" }, { tap: "Add 3 to cart" },
  { tap: "Open cart", name: "Cart B" }, { type: "Promo code", text: "LURES15" }, { tap: "Apply promo code", name: "Promo applied" },
  { tap: "Choose delivery and pay" }, { tap: "Any day Shop pickup" }, { tap: "Mobile money", exact: true, name: "Checkout B" },
  { type: "Mobile money number", text: "677000111" }, { tap: "Place order", name: "Payment prompt B" },
  { type: "Mobile money PIN", text: "1234" }, { tap: "Confirm payment" }, { wait: 1500 }, { tap: "Allow", exact: true, optional: true, name: "Order placed B" },
  { wait: 6000 },
  // Flow C: camera permission + scanner (manual entry on both sides: a simulator camera has nothing to decode), location
  // permission + distance, shop pickup, mobile money. The iOS dialogs are worded as iOS words them.
  { tap: "Back to shop", flow: "C" }, { tap: "Scan a product barcode" }, { wait: 2500 }, { tap: "Allow camera", optional: true }, { wait: 2000 }, { name: "Camera permission" }, { tap: "Allow", exact: true, optional: true }, { wait: 1500 }, { name: "Scanner" },
  { type: "Barcode number", text: "6181234567890" }, { tap: "Find product by barcode", name: "Scanned product" }, { tap: "Add 1 to cart" },
  { tap: "Open cart" }, { tap: "Choose delivery and pay" }, { tap: "Use my location" }, { wait: 2500 }, { name: "Location permission" }, { tap: "Allow While Using App", optional: true },
  { wait: 5000 }, { name: "Located" },
  { wait: 1500 }, { tap: "Any day Shop pickup", verifyGone: "Choose a delivery slot" }, { wait: 1000 }, { tap: "Mobile money", exact: true }, { type: "Mobile money number", text: "677000111" }, { tap: "Place order", name: "Payment prompt C" },
  { type: "Mobile money PIN", text: "1234" }, { tap: "Confirm payment" }, { wait: 1500 }, { name: "Order placed C" },
];
const CANDIDATES = {
  ios: [["iPhone 13", "15"], ["iPhone 14", "16"], ["iPhone 13", "14"], ["iPhone 12", "14"], ["iPhone 14 Pro", "16"], ["iPhone 15", "17"], ["iPhone 15 Pro", "17"], ["iPhone 16", "18"], ["iPhone 11", "13"]],
  "android-virtual": [["Galaxy A33 5G", "13"], ["Galaxy Tab S4", "10"], ["Pixel 7", "13"], ["Pixel 6", "12"], ["Galaxy S21", "11"]],
  // The first session builds/launches WebDriverAgent and can exceed a single request's timeout: try three times.
  "ios-local": [["local iPhone simulator", "latest"], ["local iPhone simulator", "latest"], ["local iPhone simulator", "latest"]],
  "android-real": [["Galaxy A12", "11"], ["Galaxy A13", "12"], ["Galaxy A21s", "10"], ["Pixel 6", "12"]],
};

// Fresh connection per call, with retries: the device side can pause long enough for an idle socket to close.
const simCall = async (p, b) => {
  for (let i = 0; ; i++) {
    try { return await (await fetch(SIM + p, { method: "POST", headers: { "content-type": "application/json", connection: "close" }, body: JSON.stringify(b) })).json(); }
    catch (e) { if (i >= 3) throw e; await new Promise((r) => setTimeout(r, 1000 * (i + 1))); }
  }
};
function parseSim(tree) {
  const out = [];
  for (const line of tree.split("\n")) {
    const m = line.match(/^\s*- (button|textbox|radio|heading|generic|link|checkbox) "([^"]+)"(.*?)(?:\[ref=(e\d+)\]|:?\s*$)/);
    const t = line.match(/^\s*- generic \[ref=(e\d+)\]: (.+)$/);
    if (m) out.push({ role: m[1] === "generic" ? "text" : m[1], label: m[2].trim(), ref: m[4] }); else if (t) out.push({ role: "text", label: t[2].trim(), ref: t[1] });
  }
  return out;
}
const simEls = async () => parseSim((await simCall("/act", { session: "pc", action: "screen" })).screen);
async function simDo(step) {
  const els = await simEls(); const starts = (e, l) => step.exact ? e.label.toLowerCase() === l.toLowerCase() : e.label.toLowerCase().startsWith(l.toLowerCase());
  if (step.tap) { const e = els.find((x) => ["button", "radio", "link"].includes(x.role) && starts(x, step.tap)); if (!e) throw new Error(`sim: no ${step.tap}`); await simCall("/act", { session: "pc", action: "tap", ref: e.ref }); }
  if (step.type) { const e = els.find((x) => x.role === "textbox" && starts(x, step.type)); if (!e) throw new Error(`sim: no ${step.type}`); await simCall("/act", { session: "pc", action: "type", ref: e.ref, text: step.text }); }
}
const norm = (s) => s.toLowerCase().replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

// Outcome parity: on an "Order placed" screen, the order itself (lines, total, delivery and payment) must be identical.
const ORDER_RE = [/^order [a-z]+-\d+ placed$/, /^\d+ × /, /^total /, /(cash|mobile money)/];
function outcomeOf(els) { return [...new Set(els.map((e) => norm(e.label).replace(/,?\s*paid \([^)]*\)/, ", paid")).filter((l) => ORDER_RE.some((r) => r.test(l))))].sort(); } // receipts differ by provider (SIMULATED- vs SANDBOX-)
function sameOutcome(a, b) { const A = outcomeOf(a), B = outcomeOf(b); return { same_order: A.length > 0 && A.length === B.length && A.every((x, i) => x === B[i]), order_sim: A, order_device: B }; }
function compare(a, b) {
  const ACT = new Set(["button", "radio", "textbox", "link"]);
  const act = (xs) => new Set(xs.filter((x) => ACT.has(x.role)).map((x) => `${x.role === "radio" ? "button" : x.role}:${norm(x.label)}`));
  const txt = (xs) => new Set(xs.map((x) => norm(x.label)).filter((l) => l.length > 1));
  const A = act(a), B = act(b), TA = txt(a), TB = txt(b);
  const inter = [...A].filter((x) => B.has(x)).length, union = new Set([...A, ...B]).size;
  const cov = [...TA].filter((t) => TB.has(t) || [...TB].some((u) => u.includes(t) || t.includes(u))).length;
  return { actionable_parity: union ? +(inter / union).toFixed(3) : 1, text_coverage: TA.size ? +(cov / TA.size).toFixed(3) : 1,
    only_in_sim: [...A].filter((x) => !B.has(x)).slice(0, 8), only_on_device: [...B].filter((x) => !A.has(x)).slice(0, 8) };
}

const report = { lane: LANE, started_at: new Date().toISOString(), device: null, screens: [], errors: [] };
let s = null;
for (const [deviceName, platformVersion] of CANDIDATES[LANE]) {
  try {
    s = await cloud.startSession({ platformName: LANE.startsWith("ios") ? "ios" : "android", deviceName, platformVersion, app: APP, udid: APP,
      isRealMobile: LANE === "android-real", build: "Shipvo parity", name: `parity ${LANE}`, w3c: true, autoGrantPermissions: LANE !== "ios-local" });   // iOS simulator: let the system dialogs appear, as they do for a person
    report.device = `${deviceName} (${LANE.startsWith("ios") ? "iOS" : "Android"} ${platformVersion})`; break;
  } catch (e) { report.errors.push(`session ${deviceName} ${platformVersion}: ${e.message}`); }
}
if (!s) { writeFileSync(`parity-${LANE}.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); process.exit(0); }
await cloud.setLocation(s, 4.0225, 9.6967);   // Bonanjo, Douala: 0.7 km from the shop (flow C)
await new Promise((r) => setTimeout(r, 15000)); // let live content load
// The simulated phone mirrors the device under test: platform wording, and no enrolled biometrics (CI simulators have none).
await simCall("/session", { session: "pc", device: { platform: LANE.startsWith("ios") ? "ios" : "android", api: LANE.startsWith("ios") ? 17 : 30, biometrics: { enrolled: false } } });
let simOk = true, devOk = true;
for (const step of FLOW) {
  if (step.wait) { await new Promise((r) => setTimeout(r, step.wait)); continue; }
  try { await simDo(step); } catch (e) { if (!step.optional) { simOk = false; report.errors.push(e.message); } }
  try { if (step.tap) await cloud.tap(s, step.tap, { once: !!step.optional, exact: !!step.exact });
    if (step.tap && step.verifyGone) for (let i = 0; i < 3; i++) { const els = await cloud.elements(s).catch(() => []); if (!els.some((e) => norm(e.label).startsWith(norm(step.verifyGone)))) break; await new Promise((r) => setTimeout(r, 1200)); await cloud.tap(s, step.tap).catch(() => {}); } if (step.type) await cloud.type(s, step.type, step.text); } catch (e) { if (!step.optional) { devOk = false; report.errors.push(`device: ${e.message}`); } }
  if (step.name) {
    const [a, b] = [await simEls(), await cloud.fullScreen(s).catch((e) => { report.errors.push(`device screen: ${e.message}`); return []; })];
    report.screens.push({ screen: step.name, sim_elements: a.length, device_elements: b.length, ...compare(a, b), ...(/^Order placed/.test(step.name) ? sameOutcome(a, b) : {}) });
    if (step.name === "Checkout" || step.flowC || b.length < 3 || /Camera permission|Scanner|Location permission|Located|Payment prompt C|Order placed C/.test(step.name)) { try { writeFileSync(`source-${LANE}-${step.name.replace(/\W+/g, "_")}.xml`, await cloud.source(s)); } catch {} }
  }
}
await cloud.endSession(s);
report.flow = { sim_completed: simOk, device_completed: devOk };
const n = report.screens.length || 1;
report.summary = { mean_actionable_parity: +(report.screens.reduce((x, y) => x + y.actionable_parity, 0) / n).toFixed(3), mean_text_coverage: +(report.screens.reduce((x, y) => x + y.text_coverage, 0) / n).toFixed(3) };
writeFileSync(`parity-${LANE}.json`, JSON.stringify(report, null, 2));
const md = [`# Parity: simulator vs ${report.device}`, ``, `| Screen | Elements (sim / device) | Actionable parity | Text coverage | Only in sim | Only on device |`, `| --- | --- | --- | --- | --- | --- |`,
  ...report.screens.map((x) => `| ${x.screen}${"same_order" in x ? (x.same_order ? " (same order ✓)" : " (ORDER DIFFERS)") : ""} | ${x.sim_elements} / ${x.device_elements} | ${(x.actionable_parity * 100).toFixed(0)}% | ${(x.text_coverage * 100).toFixed(0)}% | ${x.only_in_sim.join("<br>")} | ${x.only_on_device.join("<br>")} |`),
  ``, `**Mean actionable parity:** ${(report.summary.mean_actionable_parity * 100).toFixed(1)}% · **Mean text coverage:** ${(report.summary.mean_text_coverage * 100).toFixed(1)}% · Flow completed: sim ${simOk ? "yes" : "no"}, device ${devOk ? "yes" : "no"}`,
  report.errors.length ? `\nErrors:\n${report.errors.map((e) => `- ${e}`).join("\n")}` : ""].join("\n");
writeFileSync(`parity-${LANE}.md`, md); console.log(md);
