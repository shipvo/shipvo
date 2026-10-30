#!/usr/bin/env node
// Parity: run the same flow on the simulator and on a real Android build (emulator or phone), screen by screen,
// and measure how closely what an agent sees matches. Writes parity-report.json and parity-report.md.
//   node sim/parity.mjs [--sim http://localhost:4545] [--out .]
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { dump as nativeDump, act as nativeAct } from "./native.mjs";
import * as nativeMod from "./native.mjs";
import { execFileSync } from "node:child_process";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SIM = arg("sim", "http://localhost:4545"), OUT = arg("out", ".");
const sleep = (ms) => execFileSync("sleep", [String(ms / 1000)]);

// Two real purchases, by visible labels (no refs, no ids). Each starts from a fresh app.
const FLOWS = [
  { title: "A: browse, delivery, cash", steps: [
    { name: "Home" },
    { tap: /^Chrome Spoon 30 g/, name: "Product" },
    { tap: /^Increase quantity$/ },
    { tap: /^Add 2 to cart$/, name: "Added" },
    { tap: /^Open cart/, name: "Cart" },
    { tap: /^Choose delivery and pay$/, name: "Checkout" },
    { tap: /^Friday 14:00/ },
    { type: /^Delivery address$/, text: "Bonapriso Douala" },
    { tap: /^Place order$/, name: "Order placed" },
  ] },
  { title: "B: search, promo, pickup, mobile money", steps: [
    { tap: /^Allow$/, optional: true }, { wait: 6000 },   // notification permission (API 33+ / iOS) and the confirmation banner
    { tap: /^Back to shop$/ },
    { tap: /^Open search$/, name: "Search" },
    { type: /^Search products$/, text: "popper", name: "Search results" },
    { tap: /^Surface Popper 9 cm/, name: "Product B" },
    { tap: /^Increase quantity$/ }, { tap: /^Increase quantity$/ },
    { tap: /^Add 3 to cart$/ },
    { tap: /^Open cart/, name: "Cart B" },
    { type: /^Promo code$/, text: "LURES15" },
    { tap: /^Apply promo code$/, name: "Promo applied" },
    { tap: /^Choose delivery and pay$/ },
    { tap: /^Any day Shop pickup/ },
    { tap: /^Mobile money$/, name: "Checkout B" },
    { type: /^Mobile money number$/, text: "677000111" },
    { tap: /^Place order$/, name: "Payment prompt B" },
    { type: /^Mobile money PIN$/, text: "1234" },
    { tap: /^Confirm payment$/ },
    { waitFor: /^Share order$/, timeoutMs: 15000, name: "Order placed B" },
  ] },
  // Native features: camera scan (the emulator's virtual scene shows the barcode), location (adb geo fix),
  // the system permission dialogs, the in-app mobile money prompt. The emulator has no enrolled fingerprint,
  // so the simulated phone is told the same (biometrics.enrolled=false) and the app skips that prompt on both.
  { title: "C: scan, location, mobile money", steps: [
    { wait: 6000 },
    { tap: /^Back to shop$/ },
    { tap: /^Scan a product barcode$/, name: "Camera permission" },
    { tap: /^Allow camera$/, optional: true },            // a person taps the app's button if the system dialog has not shown
    { tap: /^While using the app$/, name: "Scanner" },
    { waitFor: /^Add 1 to cart$/, timeoutMs: 45000, name: "Scanned product" },
    { tap: /^Add 1 to cart$/ },
    { tap: /^Open cart/ },
    { tap: /^Choose delivery and pay$/ },
    { tap: /^Use my location$/, name: "Location permission" },
    { tap: /^While using the app$/ },
    { waitFor: /km from the shop/, timeoutMs: 20000, name: "Located" },
    { tap: /^Any day Shop pickup/ },
    { tap: /^Mobile money$/ },
    { type: /^Mobile money number$/, text: "677000111" },
    { tap: /^Place order$/, name: "Payment prompt" },
    { type: /^Mobile money PIN$/, text: "1234" },
    { tap: /^Confirm payment$/ },
    { waitFor: /^Share order$/, timeoutMs: 15000, name: "Order placed C" },
  ] },
];
const SIM_DEVICE = { platform: "android", api: 30, biometrics: { enrolled: false }, camera: { barcode: { type: "ean13", data: "6181234567890" }, delayMs: 1500 } };

/* ---------- simulator driver ---------- */
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
    if (m) out.push({ role: m[1] === "generic" ? "text" : m[1], label: m[2].trim(), ref: m[4], disabled: /\[disabled\]/.test(m[3]) });
    else if (t) out.push({ role: "text", label: t[2].trim(), ref: t[1] });
  }
  return out;
}
const sim = {
  async start() { await simCall("/session", { session: "parity", device: SIM_DEVICE }); },
  async restart() { await simCall("/session", { session: "parity", device: SIM_DEVICE }); },
  async waitFor(re, timeoutMs) { const t0 = Date.now(); while (Date.now() - t0 < timeoutMs) { if ((await this.elements()).some((e) => re.test(e.label))) return; await new Promise((r) => setTimeout(r, 700)); } throw new Error(`sim: never saw ${re}`); },
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
  async restart() {
    execFileSync("adb", ["shell", "am", "force-stop", "dev.purenative.tide"]);
    execFileSync("adb", ["shell", "monkey", "-p", "dev.purenative.tide", "-c", "android.intent.category.LAUNCHER", "1"]);
    sleep(8000);
  },
  async elements() { return nativeFull(); },
  async waitFor(re, timeoutMs) { const t0 = Date.now(); while (Date.now() - t0 < timeoutMs) { if (nativeDump().some((n) => re.test(n.label))) return; sleep(1000); } throw new Error(`native: never saw ${re}`); },
  async find(re, roles) {
    for (let i = 0; i < 8; i++) {
      const el = nativeDump().find((n) => roles.includes(n.role) && re.test(n.label));
      if (el) return el;
      nativeAct("scroll", "down");
    }
    throw new Error(`native: no element ${re}`);
  },
  async tap(re) { const el = await this.find(re, ["button", "radio"]); execFileSync("adb", ["shell", "input", "tap", String(el.x), String(el.y)]); sleep(800); for (let i = 0; i < 8; i++) nativeAct("scroll", "up"); },
  async type(re, text) { const el = await this.find(re, ["textbox"]); execFileSync("adb", ["shell", "input", "tap", String(el.x), String(el.y)]); sleep(400); execFileSync("adb", ["shell", "input", "text", text.replace(/ /g, "%s")]); execFileSync("adb", ["shell", "input", "keyevent", "111"]); sleep(400);
    // A phone pad may ignore Escape; close the keyboard with Back, as a person would, so it does not cover the screen.
    if (/mInputShown=true/.test(execFileSync("adb", ["shell", "dumpsys", "input_method"]).toString())) { execFileSync("adb", ["shell", "input", "keyevent", "4"]); sleep(500); } },
};

/* ---------- compare ---------- */
const norm = (s) => s.toLowerCase().replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const ACTION = new Set(["button", "radio", "textbox", "checkbox", "link"]);

// Outcome parity: on an "Order placed" screen, the order itself (lines, total, delivery and payment) must be identical.
const ORDER_RE = [/^order [a-z]+-\d+ placed$/, /^\d+ × /, /^total /, /(cash|mobile money)/];
function outcomeOf(els) { return [...new Set(els.map((e) => norm(e.label).replace(/\s*\(paid [^)]*\)/, " (paid)")).filter((l) => ORDER_RE.some((r) => r.test(l))))].sort(); } // receipts differ by provider (SIMULATED- vs SANDBOX-)
function sameOutcome(a, b) { const A = outcomeOf(a), B = outcomeOf(b); return { same_order: A.length > 0 && A.length === B.length && A.every((x, i) => x === B[i]), order_sim: A, order_device: B }; }
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
for (const [fi, flow] of FLOWS.entries()) {
  for (const step of flow.steps) {
    if (step.wait) { await new Promise((r) => setTimeout(r, step.wait)); continue; }
    for (const [nm, d] of [["sim", sim], ["native", native]]) {
      try { if (step.tap) await d.tap(step.tap); if (step.type) await d.type(step.type, step.text); if (step.waitFor) await d.waitFor(step.waitFor, step.timeoutMs ?? 15000); }
      catch (e) { if (step.optional) continue; d.ok = false; const msg = `${nm} ${flow.title} ${step.name ?? step.tap ?? step.type ?? step.waitFor}: ${e.message}`; (report.flow.errors ??= []).push(msg); console.log(`[parity] ERROR ${msg}`);
        try {
          const n = (report.flow.debug?.length ?? 0) + 1; const shot = join(OUT, `debug-${n}.png`);
          try { writeFileSync(shot, execFileSync("adb", ["exec-out", "screencap", "-p"], { maxBuffer: 64 << 20 })); } catch {}
          let focus = ""; try { focus = execFileSync("adb", ["shell", "dumpsys", "window"]).toString().split("\n").filter((l) => /mCurrentFocus|mFocusedApp/.test(l)).join(" | ").trim(); } catch {}
          let perms = ""; try { perms = execFileSync("adb", ["shell", "dumpsys", "package", "dev.purenative.tide"]).toString().split("\n").filter((l) => /CAMERA|ACCESS_FINE_LOCATION/.test(l) && /granted/.test(l)).map((l) => l.trim()).join(" | "); } catch {}
          (report.flow.debug ??= []).push({ at: msg.slice(0, 80), screenshot: shot, focus, perms, sim: (await sim.elements()).map((x) => `${x.role}:${x.label}`).slice(0, 40), device: nativeDump().map((x) => `${x.role}:${x.label}`).slice(0, 40) });
        } catch {} }
    }
    if (step.name) {
      const [a, b] = [await sim.elements(), await native.elements()];
      const row = { flow: flow.title, screen: step.name, sim_elements: a.length, device_elements: b.length, ...compare(a, b), ...(/^Order placed/.test(step.name) ? sameOutcome(a, b) : {}) };
      report.screens.push(row);
      console.log(`[parity] ${flow.title} / ${step.name}: actionable ${(row.actionable_parity * 100).toFixed(0)}%, text ${(row.text_coverage * 100).toFixed(0)}% (${a.length}/${b.length})`);
      writeFileSync(join(OUT, "parity-report.json"), JSON.stringify(report, null, 2)); // partial results survive a timeout
    }
  }
}
const last = report.screens.at(-1);
report.flow.sim_completed = sim.ok; report.flow.device_completed = native.ok;
const finals = report.screens.filter((x) => /^Order placed/.test(x.screen));
report.flow.same_outcome = sim.ok && native.ok && finals.length === FLOWS.length && finals.every((x) => x.actionable_parity >= 0.99 && x.same_order === true);
report.summary = {
  screens: report.screens.length,
  mean_actionable_parity: +(report.screens.reduce((a, s) => a + s.actionable_parity, 0) / report.screens.length).toFixed(3),
  mean_text_coverage: +(report.screens.reduce((a, s) => a + s.text_coverage, 0) / report.screens.length).toFixed(3),
  flow_parity: report.flow.same_outcome,
  android_not_responding_dialogs: nativeMod.anrCount,
};
writeFileSync(join(OUT, "parity-report.json"), JSON.stringify(report, null, 2));
const md = [`# Simulator vs device parity`, ``, `Flows: ${FLOWS.map((f) => f.title).join("; ")}.`, ``,
  `| Flow | Screen | Elements (sim / device) | Actionable parity | Text coverage | Only in sim | Only on device |`, `| --- | --- | --- | --- | --- | --- | --- |`,
  ...report.screens.map((s) => `| ${s.flow.slice(0, 1)} | ${s.screen}${"same_order" in s ? (s.same_order ? " (same order ✓)" : " (ORDER DIFFERS)") : ""} | ${s.sim_elements} / ${s.device_elements} | ${(s.actionable_parity * 100).toFixed(0)}% | ${(s.text_coverage * 100).toFixed(0)}% | ${s.only_in_sim.join("<br>")} | ${s.only_on_device.join("<br>")} |`),
  ``, `**Mean actionable parity:** ${(report.summary.mean_actionable_parity * 100).toFixed(1)}%  ·  **Mean text coverage:** ${(report.summary.mean_text_coverage * 100).toFixed(1)}%  ·  **Same outcome:** ${report.flow.same_outcome ? "yes" : "no"}  ·  **"App isn't responding" dialogs on device:** ${nativeMod.anrCount}`,
  report.flow.errors?.length ? `\nErrors:\n${report.flow.errors.map((e) => `- ${e}`).join("\n")}` : ""].join("\n");
writeFileSync(join(OUT, "parity-report.md"), md);
console.log(md);
