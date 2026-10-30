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
  { type: "Delivery address", text: "Bonapriso Douala" }, { tap: "Place order", name: "Order placed" },
];
const CANDIDATES = {
  ios: [["iPhone 16", "18"], ["iPhone 15", "17"], ["iPhone 14", "16"]],
  "android-real": [["Galaxy A12", "11"], ["Galaxy A13", "12"], ["Galaxy A21s", "10"], ["Pixel 6", "12"]],
};

const simCall = async (p, b) => (await fetch(SIM + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })).json();
function parseSim(tree) {
  const out = [];
  for (const line of tree.split("\n")) {
    const m = line.match(/^\s*- (button|textbox|radio|heading|generic|link|checkbox) "([^"]+)"(.*?)\[ref=(e\d+)\]/);
    const t = line.match(/^\s*- generic \[ref=(e\d+)\]: (.+)$/);
    if (m) out.push({ role: m[1] === "generic" ? "text" : m[1], label: m[2].trim(), ref: m[4] }); else if (t) out.push({ role: "text", label: t[2].trim(), ref: t[1] });
  }
  return out;
}
const simEls = async () => parseSim((await simCall("/act", { session: "pc", action: "screen" })).screen);
async function simDo(step) {
  const els = await simEls(); const starts = (e, l) => e.label.toLowerCase().startsWith(l.toLowerCase());
  if (step.tap) { const e = els.find((x) => ["button", "radio", "link"].includes(x.role) && starts(x, step.tap)); if (!e) throw new Error(`sim: no ${step.tap}`); await simCall("/act", { session: "pc", action: "tap", ref: e.ref }); }
  if (step.type) { const e = els.find((x) => x.role === "textbox" && starts(x, step.type)); if (!e) throw new Error(`sim: no ${step.type}`); await simCall("/act", { session: "pc", action: "type", ref: e.ref, text: step.text }); }
}
const norm = (s) => s.toLowerCase().replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
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
    s = await cloud.startSession({ platformName: LANE === "ios" ? "iOS" : "Android", deviceName, platformVersion, app: APP,
      isRealMobile: LANE !== "ios", build: "PureNative parity", name: `parity ${LANE}`, w3c: true, autoGrantPermissions: true });
    report.device = `${deviceName} (${LANE === "ios" ? "iOS" : "Android"} ${platformVersion})`; break;
  } catch (e) { report.errors.push(`session ${deviceName} ${platformVersion}: ${e.message}`); }
}
if (!s) { writeFileSync(`parity-${LANE}.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); process.exit(0); }
await new Promise((r) => setTimeout(r, 15000)); // let live content load
await simCall("/session", { session: "pc" });
let simOk = true, devOk = true;
for (const step of FLOW) {
  try { await simDo(step); } catch (e) { simOk = false; report.errors.push(e.message); }
  try { if (step.tap) await cloud.tap(s, step.tap); if (step.type) await cloud.type(s, step.type, step.text); } catch (e) { devOk = false; report.errors.push(`device: ${e.message}`); }
  if (step.name) {
    const [a, b] = [await simEls(), await cloud.fullScreen(s).catch((e) => { report.errors.push(`device screen: ${e.message}`); return []; })];
    report.screens.push({ screen: step.name, sim_elements: a.length, device_elements: b.length, ...compare(a, b) });
  }
}
await cloud.endSession(s);
report.flow = { sim_completed: simOk, device_completed: devOk };
const n = report.screens.length || 1;
report.summary = { mean_actionable_parity: +(report.screens.reduce((x, y) => x + y.actionable_parity, 0) / n).toFixed(3), mean_text_coverage: +(report.screens.reduce((x, y) => x + y.text_coverage, 0) / n).toFixed(3) };
writeFileSync(`parity-${LANE}.json`, JSON.stringify(report, null, 2));
const md = [`# Parity: simulator vs ${report.device}`, ``, `| Screen | Elements (sim / device) | Actionable parity | Text coverage | Only in sim | Only on device |`, `| --- | --- | --- | --- | --- | --- |`,
  ...report.screens.map((x) => `| ${x.screen} | ${x.sim_elements} / ${x.device_elements} | ${(x.actionable_parity * 100).toFixed(0)}% | ${(x.text_coverage * 100).toFixed(0)}% | ${x.only_in_sim.join("<br>")} | ${x.only_on_device.join("<br>")} |`),
  ``, `**Mean actionable parity:** ${(report.summary.mean_actionable_parity * 100).toFixed(1)}% · **Mean text coverage:** ${(report.summary.mean_text_coverage * 100).toFixed(1)}% · Flow completed: sim ${simOk ? "yes" : "no"}, device ${devOk ? "yes" : "no"}`,
  report.errors.length ? `\nErrors:\n${report.errors.map((e) => `- ${e}`).join("\n")}` : ""].join("\n");
writeFileSync(`parity-${LANE}.md`, md); console.log(md);
