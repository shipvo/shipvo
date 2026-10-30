#!/usr/bin/env node
// Native driver: the same commands as the simulator (screen, tap, type, scroll, back), against a real Android
// app on an emulator or phone, through Android's own accessibility tree (uiautomator) over adb.
//   ANDROID_SERIAL=<device> node sim/native.mjs screen | tap <ref> | type <ref> "<text>" | scroll <up|down> | back
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const REFS = process.env.PN_NATIVE_REFS || "/tmp/pn-native-refs.json";
const adb = (...a) => execFileSync("adb", a, { encoding: "utf8", maxBuffer: 32 << 20 });

export let anrCount = 0;
/** Android's "isn't responding" dialog: a person taps Wait. Count it so it shows in the report. */
function dismissAnr(nodes) {
  const wait = nodes.find((n) => n.role === "button" && /^wait$/i.test(n.label));
  const close = nodes.find((n) => n.role === "button" && /^close app$/i.test(n.label));
  if (wait && close) { anrCount++; adb("shell", "input", "tap", String(wait.x), String(wait.y)); execFileSync("sleep", ["3"]); return true; }
  return false;
}
export function dump() {
  for (let i = 0; i < 6; i++) { const n = rawDump(); if (!dismissAnr(n)) return n; }
  return rawDump();
}
let lastXml = "";
/** The last raw uiautomator XML (diagnostics). */
export const lastDumpXml = () => lastXml;
function rawDump() {
  let xml = "";
  for (let i = 0; i < 3 && !xml.includes("<hierarchy"); i++) {
    try { adb("shell", "uiautomator", "dump", "/sdcard/pn.xml"); xml = adb("shell", "cat", "/sdcard/pn.xml"); } catch {}
  }
  // Walk the XML as a tree so "inside the modal" means descendant, not "later in the file" (uiautomator lists
  // overlays before the content they cover).
  const nodes = []; const stack = []; let rootArea = 0, modal = null; let idx = 0;
  for (const m of xml.matchAll(/<node ([^>]*?)(\/?)>|<\/node>/g)) {
    if (m[0] === "</node>") { stack.pop(); continue; }
    const a = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], x[2].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#10;/g, " ")]));
    const self = m[2] === "/"; const id = idx++; const parent = stack[stack.length - 1] ?? null;
    const b = (a.bounds || "").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!self) stack.push(id);
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    if (x2 - x1 < 2 || y2 - y1 < 2) continue;
    const area = (x2 - x1) * (y2 - y1); if (!rootArea) rootArea = area;
    const ancestors = [...stack.slice(0, self ? stack.length : stack.length - 1)];
    // A labelled view covering the screen, drawn over sibling content, is a modal sheet: TalkBack and iOS expose only it.
    const cls = (a.class || "").split(".").pop();
    const role = a.checkable === "true" && /Radio/.test(cls) ? "radio"
      : cls === "EditText" ? "textbox"
      : a.clickable === "true" || cls === "Button" ? "button"
      : a.heading === "true" ? "heading" : "text";
    const label = (a["content-desc"] || a.text || "").trim();
    if (!label && role === "text") continue;
    nodes.push({ role, label, value: cls === "EditText" ? a.text : undefined, x: (x1 + x2) >> 1, y: (y1 + y2) >> 1,
      selected: a.selected === "true" || a.checked === "true", disabled: a.enabled === "false", id, ancestors });
  }
  // Modal sheets: the app marks what is behind them importantForAccessibility="no-hide-descendants", which Android's
  // accessibility tree (and this dump) already omits, so no heuristic is needed here.
  const out = nodes; void modal; void rootArea;
  lastXml = xml;
  return out.map(({ id, ancestors, ...n }) => n);
}

/** Diagnostic: large nodes (≥ 85% of the screen) with their class, label and bounds, to tune the modal rule. */
export function largeNodes() {
  let xml = ""; try { adb("shell", "uiautomator", "dump", "/sdcard/pn.xml"); xml = adb("shell", "cat", "/sdcard/pn.xml"); } catch {}
  const out = []; let rootArea = 0;
  for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    const b = (a.bounds || "").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/); if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number); const area = (x2 - x1) * (y2 - y1); if (!rootArea) rootArea = area;
    if (area >= rootArea * 0.85) out.push({ cls: (a.class || "").split(".").pop(), desc: a["content-desc"], bounds: a.bounds, pct: +(area / rootArea).toFixed(3) });
  }
  return out;
}

export function render(nodes) {
  const refs = {}; const lines = [];
  nodes.forEach((n, i) => {
    const ref = `n${i + 1}`; refs[ref] = { x: n.x, y: n.y };
    lines.push(`- ${n.role} "${n.label}"${n.selected ? " [selected]" : ""}${n.disabled ? " [disabled]" : ""} [ref=${ref}]${n.value ? `: ${n.value}` : ""}`);
  });
  writeFileSync(REFS, JSON.stringify(refs));
  return lines.join("\n");
}

const settle = () => execFileSync("sleep", ["0.6"]);
export function act(cmd, a, b) {
  const refs = existsSync(REFS) ? JSON.parse(readFileSync(REFS, "utf8")) : {};
  const at = (r) => refs[r] ?? (() => { throw new Error(`unknown ref ${r}; run screen first`); })();
  if (cmd === "tap") { const p = at(a); adb("shell", "input", "tap", String(p.x), String(p.y)); }
  else if (cmd === "type") { const p = at(a); adb("shell", "input", "tap", String(p.x), String(p.y)); settle(); adb("shell", "input", "text", String(b).replace(/ /g, "%s").replace(/([&|<>;()$`\\"'])/g, "\\$1")); adb("shell", "input", "keyevent", "111"); settle();
    if (/mInputShown=true/.test(adb("shell", "dumpsys", "input_method").toString())) adb("shell", "input", "keyevent", "4"); }
  else if (cmd === "scroll" && (a === "left" || a === "right")) {
    const p = b ? at(b) : { x: 540, y: 1100 }; const dx = a === "right" ? -500 : 500;
    adb("shell", "input", "swipe", String(p.x + (dx < 0 ? 250 : -250)), String(p.y), String(p.x + (dx < 0 ? 250 : -250) + dx), String(p.y), "300");
  }
  else if (cmd === "scroll") { const up = a === "up"; adb("shell", "input", "swipe", "540", up ? "700" : "1700", "540", up ? "1700" : "700", "250"); }
  else if (cmd === "back") { const n = dump().find((x) => x.role === "button" && x.label === "Back"); if (!n) throw new Error("no Back button on this screen"); adb("shell", "input", "tap", String(n.x), String(n.y)); }
  else if (cmd !== "screen") throw new Error(`unknown command ${cmd}`);
  if (cmd !== "screen") settle();
  return render(dump());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, a, b] = process.argv.slice(2);
  try { console.log(act(cmd || "screen", a, b)); } catch (e) { console.log(`ERROR: ${e.message}`); process.exit(1); }
}
