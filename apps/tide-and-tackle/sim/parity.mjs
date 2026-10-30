#!/usr/bin/env node
// Parity: run the same flow on the simulator and on a real Android build (emulator or phone), screen by screen,
// and measure how closely what an agent sees matches. Writes parity-report.json and parity-report.md.
//   node sim/parity.mjs [--sim http://localhost:4545] [--out .]
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { dump as nativeDump, act as nativeAct } from "./native.mjs";
import { execFileSync } from "node:child_process";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SIM = arg("sim", "http://localhost:4545"), OUT = arg("out", ".");
const sleep = (ms) => execFileSync("sleep", [String(ms / 1000)]);

// The flow: a real purchase, by visible labels (no refs, no ids).
const FLOW = [
  { name: "Home" },
  { tap: /^Chrome Spoon 30 g/, name: "Product" },
  { tap: /^Increase quantity$/ },
  { tap: /^Add 2 to cart$/, name: "Added" },
  { tap: /^Open cart/, name: "Cart" },
  { tap: /^Choose delivery and pay$/, name: "Checkout" },
  { tap: /^Friday 14:00/ },
  { type: /^Delivery address$/, text: "Bonapriso Douala" },
  { tap: /^Place order$/, name: "Order placed" },
];

/* ---------- simulator driver ---------- */
const simCall = async (path, body) => (await fetch(SIM + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
function parseSim(tree) {
  const out = [];
  for (const line of tree.split("\n")) {
    const m = line.match(/^\s*- (button|textbox|radio|heading|generic|link|checkbox) "([^"]+)"(.*?)\[ref=(e\d+)\]/);
    const t = line.match(/^\s*- generic \[ref=(e\d+)\]: (.+)$/);
    if (m) out.push({ role: m[1] === "generic" ? "text" : m[1], label: m[2].trim(), ref: m[4], disabled: /\[disabled\]/.test(m[3]) });
    else if (t) out.push({ role: "text", label: t[2].trim(), ref: t[1] });
  }
  return out;
}
const sim = {
  async start() { await simCall("/session", { session: "parity" }); },
  async elements() { return parseSim((await simCall("/act", { session: "parity", action: "screen" })).screen); },
  async tap(re) { const el = (await this.elements()).find((e) => ["button", "radio", "link"].includes(e.role) && re.test(e.label)); if (!el) throw new Error(`sim: no element ${re}`); await simCall("/act", { session: "parity", action: "tap", ref: el.ref }); },
  async type(re, text) { const el = (await this.elements()).find((e) => e.role === "textbox" && re.test(e.label)); if (!el) throw new Error(`sim: no field ${re}`); await simCall("/act", { session: "parity", action: "type", ref: el.ref, text }); },
};

/* ---------- native driver (Android accessibility tree) ---------- */
function nativeFull() {
  // Collect the whole scrollable screen, as the simulator sees the whole page: scroll down until nothing new.
  const seen = new Map(); let stale = 0;
  for (let i = 0; i < 8 && stale < 2; i++) {
    const before = seen.size;
    for (const n of nativeDump()) seen.set(`${n.role}|${n.label}`, n);
    stale = seen.size === before ? stale + 1 : 0;
    nativeAct("scroll", "down");
  }
  for (let i = 0; i < 8; i++) nativeAct("scroll", "up");
  return [...seen.values()];
}
const native = {
  async start() {},
  async elements() { return nativeFull(); },
  async find(re, roles) {
    for (let i = 0; i < 8; i++) {
      const el = nativeDump().find((n) => roles.includes(n.role) && re.test(n.label));
      if (el) return el;
      nativeAct("scroll", "down");
    }
    throw new Error(`native: no element ${re}`);
  },
  async tap(re) { const el = await this.find(re, ["button", "radio"]); execFileSync("adb", ["shell", "input", "tap", String(el.x), String(el.y)]); sleep(800); for (let i = 0; i < 8; i++) nativeAct("scroll", "up"); },
  async type(re, text) { const el = await this.find(re, ["textbox"]); execFileSync("adb", ["shell", "input", "tap", String(el.x), String(el.y)]); sleep(400); execFileSync("adb", ["shell", "input", "text", text.replace(/ /g, "%s")]); execFileSync("adb", ["shell", "input", "keyevent", "111"]); sleep(400); },
};

/* ---------- compare ---------- */
const norm = (s) => s.toLowerCase().replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const ACTION = new Set(["button", "radio", "textbox", "checkbox", "link"]);
function compare(a, b) {
  const act = (xs) => new Set(xs.filter((x) => ACTION.has(x.role)).map((x) => `${x.role === "radio" ? "button" : x.role}:${norm(x.label)}`));
  const txt = (xs) => new Set(xs.map((x) => norm(x.label)).filter((l) => l.length > 1));
  const A = act(a), B = act(b), TA = txt(a), TB = txt(b);
  const inter = [...A].filter((x) => B.has(x)).length, union = new Set([...A, ...B]).size;
  const textCovered = [...TA].filter((t) => TB.has(t) || [...TB].some((u) => u.includes(t) || t.includes(u))).length;
  return {
    actionable_parity: union ? +(inter / union).toFixed(3) : 1,
    text_coverage: TA.size ? +(textCovered / TA.size).toFixed(3) : 1,
    only_in_sim: [...A].filter((x) => !B.has(x)).slice(0, 10), only_on_device: [...B].filter((x) => !A.has(x)).slice(0, 10),
  };
}

const report = { started_at: new Date().toISOString(), screens: [], flow: {} };
await sim.start(); await native.start();
for (const d of [sim, native]) d.ok = true;
for (const step of FLOW) {
  for (const [nm, d] of [["sim", sim], ["native", native]]) {
    try { if (step.tap) await d.tap(step.tap); if (step.type) await d.type(step.type, step.text); }
    catch (e) { d.ok = false; report.flow[`${nm}_error`] = report.flow[`${nm}_error`] ?? `${step.name ?? step.tap ?? step.type}: ${e.message}`; }
  }
  if (step.name) {
    const [a, b] = [await sim.elements(), await native.elements()];
    report.screens.push({ screen: step.name, sim_elements: a.length, device_elements: b.length, ...compare(a, b) });
  }
}
const last = report.screens.at(-1);
report.flow.sim_completed = sim.ok; report.flow.device_completed = native.ok;
report.flow.same_outcome = sim.ok === native.ok && (last?.text_coverage ?? 0) > 0.8;
report.summary = {
  screens: report.screens.length,
  mean_actionable_parity: +(report.screens.reduce((a, s) => a + s.actionable_parity, 0) / report.screens.length).toFixed(3),
  mean_text_coverage: +(report.screens.reduce((a, s) => a + s.text_coverage, 0) / report.screens.length).toFixed(3),
  flow_parity: report.flow.same_outcome,
};
writeFileSync(join(OUT, "parity-report.json"), JSON.stringify(report, null, 2));
const md = [`# Simulator vs device parity`, ``, `Flow: buy 2 × Chrome Spoon, Friday afternoon delivery, cash.`, ``,
  `| Screen | Elements (sim / device) | Actionable parity | Text coverage | Only in sim | Only on device |`, `| --- | --- | --- | --- | --- | --- |`,
  ...report.screens.map((s) => `| ${s.screen} | ${s.sim_elements} / ${s.device_elements} | ${(s.actionable_parity * 100).toFixed(0)}% | ${(s.text_coverage * 100).toFixed(0)}% | ${s.only_in_sim.join("<br>")} | ${s.only_on_device.join("<br>")} |`),
  ``, `**Mean actionable parity:** ${(report.summary.mean_actionable_parity * 100).toFixed(1)}%  ·  **Mean text coverage:** ${(report.summary.mean_text_coverage * 100).toFixed(1)}%  ·  **Same outcome:** ${report.flow.same_outcome ? "yes" : "no"}`,
  report.flow.sim_error ? `\nSimulator error: ${report.flow.sim_error}` : "", report.flow.native_error ? `\nDevice error: ${report.flow.native_error}` : ""].join("\n");
writeFileSync(join(OUT, "parity-report.md"), md);
console.log(md);
