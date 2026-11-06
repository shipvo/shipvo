// The page script of `shipvo run`. The frame page serves it at `/__shipvo/bridge.js`. It connects to the agent
// channel as role `screen` and answers `tree` requests from the same-origin app iframe. No Playwright: the tree is
// built from the DOM, in the shape of the simulator's `- role "name" [ref=eN]` lines (slice 3b of #448).
// Differences from the simulator tree are listed in docs/run-bridge.md.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * The shared screen rules (`@shipvo/sim`), as source that the page can run. Same copy the simulator uses.
 * Only plain `export function` / `export const` lines are supported: `export default` and `export {…}` would not be stripped.
 */
export function screenRulesSource(): string {
  const path = createRequire(import.meta.url).resolve("@shipvo/sim/screen-rules.mjs");
  const src = readFileSync(path, "utf8");
  if (/^export\s+(default\b|\{|\*)/m.test(src)) throw new Error("screen-rules.mjs may only use `export function` or `export const`");
  return src.replace(/^export /gm, "");
}

/** Runs in the page. Everything it needs is nested inside, because it is serialised with `String(fn)`. */
function bridgeMain(win: any, token: string) {
  const doc = win.document;
  // A ref names one element with one role and name. If the element's content changes, it gets a new ref and the old one is stale.
  const refs = new WeakMap<object, { n: number; sig: string }>();
  const byRef = new Map<string, { el: any; sig: string }>();
  let counter = 0;
  const refOf = (el: any, sig: string) => {
    let r = refs.get(el);
    if (!r || r.sig !== sig) { r = { n: ++counter, sig }; refs.set(el, r); }
    byRef.set("e" + r.n, { el, sig });
    return "e" + r.n;
  };

  const INPUT_ROLE: Record<string, string> = { checkbox: "checkbox", radio: "radio", range: "slider", button: "button", submit: "button", reset: "button", image: "button", search: "searchbox", number: "spinbutton" };
  const TAG_ROLE: Record<string, string> = { button: "button", textarea: "textbox", select: "combobox", img: "img", ul: "list", ol: "list", li: "listitem", nav: "navigation", main: "main", dialog: "dialog", form: "form", table: "table", tr: "row", td: "cell", th: "columnheader", p: "paragraph", progress: "progressbar", article: "article", aside: "complementary" };
  const FROM_CONTENT = new Set(["button", "link", "heading", "tab", "checkbox", "radio", "switch", "menuitem", "option", "cell", "columnheader"]);
  const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

  const hidden = (el: any, cs: any) => el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true" || cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse";

  function roleOf(el: any): string {
    const explicit = norm(el.getAttribute("role")).split(" ")[0];
    if (explicit && explicit !== "presentation" && explicit !== "none") return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : "";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "input") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      return t === "hidden" ? "" : INPUT_ROLE[t] || "textbox";
    }
    if (tag === "section") return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "region" : "";
    if (tag === "img" && el.getAttribute("alt") === "") return "";
    return TAG_ROLE[tag] || "";
  }

  function textOf(node: any): string {
    if (node.nodeType === 3) return node.nodeValue || "";
    if (node.nodeType !== 1) return "";
    const tag = node.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript") return "";
    if (hidden(node, win.getComputedStyle(node))) return "";
    if (tag === "img") return node.getAttribute("alt") || "";
    const own = node.getAttribute("aria-label");
    if (own && roleOf(node)) return own;
    let out = "";
    for (const c of node.childNodes) out += textOf(c) + (c.nodeType === 1 && win.getComputedStyle(c).display !== "inline" ? " " : "");
    return out;
  }

  /** Accessible name and whether it came from the element's own content. */
  function nameOf(el: any, role: string): { name: string; fromContent: boolean } {
    const by = norm(el.getAttribute("aria-labelledby"));
    if (by) {
      const t = by.split(" ").map((id: string) => { const r = doc.getElementById(id); return r ? norm(textOf(r)) : ""; }).filter(Boolean).join(" ");
      if (t) return { name: t, fromContent: false };
    }
    const label = norm(el.getAttribute("aria-label"));
    if (label) return { name: label, fromContent: false };
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") {
      const ls = el.labels ? [...el.labels] : [];
      const t = norm(ls.map((l: any) => textOf(l)).join(" "));
      if (t) return { name: t, fromContent: false };
      if (tag === "input" && /^(button|submit|reset)$/.test(el.type) && el.value) return { name: norm(el.value), fromContent: false };
      const ph = norm(el.getAttribute("placeholder")) || norm(el.getAttribute("title"));
      return { name: ph, fromContent: false };
    }
    if (tag === "img") return { name: norm(el.getAttribute("alt")) || norm(el.getAttribute("title")), fromContent: false };
    if (FROM_CONTENT.has(role)) { const t = norm(textOf(el)); if (t) return { name: t, fromContent: true }; }
    return { name: norm(el.getAttribute("title")), fromContent: false };
  }

  function states(el: any, role: string): string {
    let s = "";
    const aria = (n: string) => el.getAttribute(n);
    const on = (n: string) => aria(n) === "true";
    if (role === "heading") { const l = aria("aria-level") || (/^h([1-6])$/i.exec(el.tagName)?.[1] ?? "2"); s += " [level=" + l + "]"; }
    if (/^(checkbox|radio|switch|menuitemcheckbox|menuitemradio)$/.test(role)) {
      if (el.tagName === "INPUT" ? el.checked : on("aria-checked")) s += " [checked]";
      else if (aria("aria-checked") === "mixed") s += " [checked=mixed]";
    }
    if (el.disabled === true || on("aria-disabled") || (el.closest && el.closest("fieldset[disabled]"))) s += " [disabled]";
    if (on("aria-expanded")) s += " [expanded]";
    if (/^(tab|option|treeitem|row|gridcell)$/.test(role) && on("aria-selected")) s += " [selected]";
    if (on("aria-pressed")) s += " [pressed]";
    return s;
  }

  const quote = (s: string) => JSON.stringify(s);
  // The simulator's snapshot is YAML-like: a key with ": " inside is wrapped in single quotes, a value with ": " in double quotes.
  const needs = (t: string) => /: | #|:$|^[\[\]{}&*!|>'"%@`#?,-]/.test(t);
  const keyLine = (pad: string, key: string, tail: string) => pad + "- " + (needs(key) ? "'" + key.replace(/'/g, "''") + "'" : key) + tail;
  const val = (t: string) => (needs(t) ? JSON.stringify(t) : t);

  function walk(el: any, depth: number, out: string[]) {
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript" || tag === "template") return;
    if (hidden(el, win.getComputedStyle(el))) return;
    const role = roleOf(el);
    const pad = "  ".repeat(depth);
    if (role) {
      const { name, fromContent } = nameOf(el, role);
      const key = role + (name ? " " + quote(name) : "") + states(el, role) + " [ref=" + refOf(el, role + "|" + name) + "]";
      if (tag === "input" || tag === "textarea") { const v = el.value; out.push(keyLine(pad, key, v && !/^(checkbox|radio|button|submit|reset)$/.test(el.type) ? ": " + val(v) : "")); return; }
      if (fromContent || tag === "img") { out.push(keyLine(pad, key, "")); return; }
      const mark = out.length; out.push("");
      for (const c of el.childNodes) child(c, depth + 1, out);
      out[mark] = keyLine(pad, key, out.length > mark + 1 ? ":" : "");
      return;
    }
    // No role: keep the text, drop the wrapper. A wrapper with only text becomes one generic line.
    const hasEl = [...el.children].length > 0;
    if (!hasEl) { const t = norm(el.textContent); if (t) out.push(pad + "- generic [ref=" + refOf(el, "generic|" + t) + "]: " + val(t)); return; }
    for (const c of el.childNodes) child(c, depth, out);
  }
  function child(c: any, depth: number, out: string[]) {
    if (c.nodeType === 1) walk(c, depth, out);
    else if (c.nodeType === 3) { const t = norm(c.nodeValue); if (t) out.push("  ".repeat(depth) + "- text: " + val(t)); }
  }

  function tree(): string {
    const frame = doc.getElementById("app");
    const d = frame && frame.contentDocument;
    if (!d || !d.body) throw new Error("the app is not loaded yet");
    (globalThis as any).__shipvoRules.clearScreenRules(d);
    (globalThis as any).__shipvoRules.applyScreenRules(d);
    try {
      const out: string[] = [];
      for (const c of d.body.childNodes) child(c, 0, out);
      return (globalThis as any).__shipvoRules.filterTree(out.join("\n"));
    } finally { (globalThis as any).__shipvoRules.clearScreenRules(d); }
  }

  /** Same code and message shape as the simulator's typed errors. */
  class ActError extends Error { code: string; constructor(code: string, msg: string) { super(msg); this.code = code; } }
  const sigOf = (el: any): string => { const role = roleOf(el); return role ? role + "|" + nameOf(el, role).name : "generic|" + norm(el.textContent); };
  const appDoc = () => { const f = doc.getElementById("app"); return f && f.contentDocument; };

  /** The element for a ref from a snapshot, or `stale_ref` if it is unknown, gone, left the page, or changed role or name. */
  function resolve(ref: unknown): any {
    const stale = () => new ActError("stale_ref", `stale ref ${ref}: the screen changed. Take a new snapshot (action "screen") and use a ref from it.`);
    const d = appDoc();
    const rec = byRef.get(String(ref));
    if (!d || !rec || !rec.el.isConnected || rec.el.ownerDocument !== d) throw stale();
    if (sigOf(rec.el) !== rec.sig || refs.get(rec.el)?.sig !== rec.sig) throw stale();
    return rec.el;
  }

  /** Say why an element cannot receive a tap. Nothing has reached the app when this throws. */
  function ready(el: any, ref: unknown) {
    const fail = (code: string, why: string) => new ActError(code, `${ref} ${why}, so nothing was sent to the app.`);
    if (hidden(el, win.getComputedStyle(el)) || el.getClientRects().length === 0) throw fail("not_visible", "is not visible");
    if (el.disabled === true || el.getAttribute("aria-disabled") === "true" || (el.closest && el.closest("fieldset[disabled]"))) throw fail("disabled", "is disabled");
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect(); const w = el.ownerDocument.defaultView;
    if (r.right <= 0 || r.bottom <= 0 || r.left >= w.innerWidth || r.top >= w.innerHeight) throw fail("not_visible", "is not visible");
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = el.ownerDocument.elementFromPoint(x, y);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) throw fail("covered", "is covered by another element");
    return { x, y, target: top && el.contains(top) ? top : el };
  }

  function tap(el: any, ref: unknown) {
    const { x, y, target } = ready(el, ref);
    mark(x, y, el);
    const w = el.ownerDocument.defaultView;
    const init = { bubbles: true, cancelable: true, composed: true, view: w, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true };
    const fire = (Ctor: any, type: string, buttons: number) => target.dispatchEvent(new Ctor(type, { ...init, buttons }));
    fire(w.PointerEvent, "pointerdown", 1); fire(w.MouseEvent, "mousedown", 1);
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
    fire(w.PointerEvent, "pointerup", 0); fire(w.MouseEvent, "mouseup", 0); fire(w.MouseEvent, "click", 0);
  }

  function type(el: any, ref: unknown, text: string, enter: boolean) {
    const field = /^(INPUT|TEXTAREA)$/.test(el.tagName) ? el : el.querySelector("input, textarea");
    if (!field) throw new ActError("not_a_field", `${ref} is not a text field. Type into a "textbox" ref.`);
    ready(field, ref);
    const w = field.ownerDocument.defaultView;
    field.focus();
    const proto = field.tagName === "TEXTAREA" ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, text);
    field.dispatchEvent(new w.InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    field.dispatchEvent(new w.Event("change", { bubbles: true }));
    if (enter) for (const t of ["keydown", "keypress", "keyup"]) field.dispatchEvent(new w.KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    return field.value as string;
  }

  function scroll(ref: unknown, direction: string) {
    const d = appDoc()!; const w = d.defaultView;
    const dx = direction === "right" ? 300 : direction === "left" ? -300 : 0;
    const dy = direction === "down" ? 600 : direction === "up" ? -600 : 0;
    if (!dx && !dy) throw new ActError("bad_direction", "scroll needs a direction: up, down, left or right.");
    let el: any = ref ? resolve(ref) : d.body;
    // The nearest ancestor that can scroll that way. Fall back to the page.
    for (; el && el !== d.body && el !== d.documentElement; el = el.parentElement) {
      const cs = w.getComputedStyle(el);
      if (dy && /auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight) break;
      if (dx && /auto|scroll/.test(cs.overflowX) && el.scrollWidth > el.clientWidth) break;
    }
    if (!el || el === d.body || el === d.documentElement) el = d.scrollingElement || d.documentElement;
    el.scrollBy({ left: dx, top: dy, behavior: "instant" });
  }

  function back() {
    const d = appDoc()!;
    for (const el of d.querySelectorAll("button, [role=button], input[type=button], input[type=submit]") as any) {
      const role = roleOf(el);
      if (role === "button" && !hidden(el, win.getComputedStyle(el)) && nameOf(el, role).name === "Back") { tap(el, "Back"); return; }
    }
    throw new Error("no Back button on this screen");
  }

  // The person can see and stop the agent (slice 4 of #448). Overlay elements live in the frame page, outside the app iframe.
  let seenAgent = false, taken = false, hideTimer: any;
  const css = doc.createElement("style");
  css.textContent = "#shipvo-agent{position:fixed;left:50%;top:40px;transform:translateX(-50%);z-index:2147483000;display:none;align-items:center;gap:8px;padding:4px 12px;border-radius:14px;background:#4f46e5;color:#fff;font:12px system-ui,sans-serif}" +
    "#shipvo-agent.paused{background:#b45309}#shipvo-agent button{border:0;border-radius:10px;padding:2px 10px;font:inherit;cursor:pointer;display:none}#shipvo-agent.paused button{display:inline-block}" +
    "#shipvo-dot{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:#4f46e5aa;border:2px solid #fff;box-shadow:0 0 0 2px #4f46e5;pointer-events:none;z-index:2147483000;display:none}" +
    "#shipvo-outline{position:fixed;border:2px solid #4f46e5;border-radius:4px;pointer-events:none;z-index:2147483000;display:none}" +
    "#shipvo-log{position:fixed;right:12px;bottom:44px;width:240px;max-width:calc(100vw - 24px);box-sizing:border-box;max-height:25%;overflow:auto;margin:0;padding:8px 8px 8px 26px;border-radius:8px;background:#111d;color:#fff;font:12px system-ui,sans-serif;z-index:2147483000;display:none}#shipvo-log li{margin:2px 0}" +
    "#shipvo-log-toggle{position:fixed;right:12px;bottom:12px;z-index:2147483000;display:none;border:0;border-radius:10px;padding:4px 10px;background:#111d;color:#fff;font:12px system-ui,sans-serif;cursor:pointer}";
  doc.head.appendChild(css);
  const make = (tag: string, id: string) => { const e = doc.createElement(tag); e.id = id; doc.body.appendChild(e); return e; };
  const banner = make("div", "shipvo-agent");
  banner.setAttribute("role", "status");
  const bannerText = doc.createElement("span"); banner.appendChild(bannerText);
  const handBack = doc.createElement("button"); handBack.type = "button"; handBack.textContent = "Hand back"; banner.appendChild(handBack);
  const dot = make("div", "shipvo-dot"), outline = make("div", "shipvo-outline"), log = make("ol", "shipvo-log");
  log.setAttribute("aria-label", "Agent steps");
  // The log can be hidden so it never covers what the agent is tapping.
  let logHidden = false;
  const logToggle = make("button", "shipvo-log-toggle") as any;
  logToggle.type = "button"; logToggle.textContent = "Hide steps"; logToggle.setAttribute("aria-expanded", "true");
  const showLog = () => { log.style.display = logHidden ? "none" : "block"; logToggle.style.display = "block"; logToggle.textContent = logHidden ? "Show steps" : "Hide steps"; logToggle.setAttribute("aria-expanded", String(!logHidden)); };
  logToggle.onclick = () => { logHidden = !logHidden; showLog(); };
  const showBanner = () => {
    banner.style.display = "flex"; banner.classList.toggle("paused", taken);
    bannerText.textContent = taken ? "You took over. The agent is paused." : "Agent is driving";
  };
  const step = (text: string, simulated = false) => {
    const li = doc.createElement("li"); li.textContent = text + (simulated ? " (simulated)" : "");
    if (simulated) li.setAttribute("data-simulated", "true");
    log.appendChild(li); showLog(); log.scrollTop = log.scrollHeight;
    while (log.children.length > 50) log.removeChild(log.firstChild!);
  };
  /** Where the scaled app iframe is on the frame page. */
  const toPage = () => { const f = doc.getElementById("app"); const r = f.getBoundingClientRect(); const k = f.offsetWidth ? r.width / f.offsetWidth : 1; return { left: r.left, top: r.top, k }; };
  function mark(x: number, y: number, el: any) {
    const o = toPage(), b = el.getBoundingClientRect();
    dot.style.left = o.left + x * o.k + "px"; dot.style.top = o.top + y * o.k + "px"; dot.style.display = "block";
    Object.assign(outline.style, { left: o.left + b.left * o.k + "px", top: o.top + b.top * o.k + "px", width: b.width * o.k + "px", height: b.height * o.k + "px", display: "block" });
    win.clearTimeout(hideTimer);
    hideTimer = win.setTimeout(() => { dot.style.display = "none"; outline.style.display = "none"; }, 1500);
  }
  /** Plain words for a step that worked. Taken before the action runs, so the name is the one the agent saw. */
  const describe = (m: any): string => {
    const target = () => { try { const e = byRef.get(String(m.ref))?.el; if (!e) return "an element"; const r = roleOf(e); const n = r ? nameOf(e, r).name : norm(e.textContent); return (r || "element") + (n ? " " + quote(n) : ""); } catch { return "an element"; } };
    if (m.type === "tap") return "Tapped " + target();
    if (m.type === "type") return "Typed " + quote(String(m.text ?? "")) + " into " + target() + (m.enter ? " and pressed Enter" : "");
    if (m.type === "scroll") return "Scrolled " + m.direction + (m.ref ? " in " + target() : "");
    return "Pressed Back";
  };
  function takeOver(e: any) {
    if (!e.isTrusted || taken || !seenAgent) return;
    if (e.target && e.target.closest && e.target.closest("#shipvo-agent, #shipvo-log-toggle")) return;
    taken = true; showBanner(); step("You took over. The agent is paused.");
  }
  handBack.onclick = () => { taken = false; showBanner(); step("You handed back. The agent can continue."); };
  const watch = (d: any) => { if (!d) return; for (const t of ["pointerdown", "touchstart", "keydown"]) d.addEventListener(t, takeOver, true); };
  watch(doc);
  const frameEl = doc.getElementById("app");
  const watchApp = () => { try { watch(frameEl.contentDocument); } catch {} };
  frameEl.addEventListener("load", watchApp); watchApp();
  // Device events from the simulated phone are not the app's own: the log marks them.
  win.addEventListener("message", (e: any) => {
    const d = e.data;
    if (d && d.type === "shipvo:system-sheet" && seenAgent) step(d.open !== false ? "System permission sheet opened" : "System permission sheet closed", true);
  });

  const sleep = (ms: number) => new Promise((r) => win.setTimeout(r, ms));
  /** Give the app a moment to react, and wait for a page load a tap started. */
  async function settle() {
    await sleep(250);
    for (let i = 0; i < 30; i++) { const d = appDoc(); if (d && d.readyState === "complete" && d.body) break; await sleep(100); }
    await sleep(50);
  }
  const screenOrUndefined = () => { try { return tree(); } catch { return undefined; } };

  async function act(m: any) {
    switch (m.type) {
      case "tap": tap(resolve(m.ref), m.ref); break;
      case "type": { const value = type(resolve(m.ref), m.ref, String(m.text ?? ""), !!m.enter); await settle(); return { delivery: "delivered", value, screen: tree() }; }
      case "scroll": scroll(m.ref, m.direction); break;
      case "back": back(); break;
      default: throw new Error("unknown request: " + m.type);
    }
    await settle();
    return { delivery: "delivered", screen: tree() };
  }

  const ws = new win.WebSocket((win.location.protocol === "https:" ? "wss://" : "ws://") + win.location.host + "/__shipvo/agent?role=screen&token=" + encodeURIComponent(token));
  ws.onmessage = (e: any) => {
    let m: any; try { m = JSON.parse(String(e.data)); } catch { return; }
    if (!m || typeof m.id !== "number") return;
    // Reading the screen changes nothing, so it neither counts as the agent arriving nor is blocked by a take-over.
    if (m.type !== "tree") seenAgent = true;
    if (taken && m.type !== "tree") { ws.send(JSON.stringify({ id: m.id, type: m.type, ok: false, code: "taken_over", error: "the person took over" })); return; }
    const words = /^(tap|type|scroll|back)$/.test(m.type) ? (showBanner(), describe(m)) : "";
    try {
      if (m.type === "tree") ws.send(JSON.stringify({ id: m.id, type: "tree", ok: true, tree: tree() }));
      else if (/^(tap|type|scroll|back)$/.test(m.type)) {
        act(m).then((r) => { step(words); return r; }).then((r) => ws.send(JSON.stringify({ id: m.id, type: m.type, ok: true, ...r })),
          (err: any) => ws.send(JSON.stringify({ id: m.id, type: m.type, ok: false, ...(err && err.code ? { code: err.code } : {}), error: String(err && err.message || err), screen: screenOrUndefined() })));
      }
      else ws.send(JSON.stringify({ id: m.id, type: m.type, ok: false, error: "unknown request: " + m.type }));
    } catch (err: any) { ws.send(JSON.stringify({ id: m.id, type: m.type, ok: false, error: String(err && err.message || err) })); }
  };
}

/** The script text served at `/__shipvo/bridge.js`. It reads the session token from its own `data-token` attribute and then removes the attribute. */
export function bridgeScript(rules: string = screenRulesSource()): string {
  return `(function(){
var __rules=(function(){${rules}
return {clearScreenRules:clearScreenRules,applyScreenRules:applyScreenRules,filterTree:filterTree};})();
globalThis.__shipvoRules=__rules;
var tag=document.currentScript;
var tok=tag?tag.getAttribute("data-token")||"":"";
if(tag)tag.removeAttribute("data-token");
(${bridgeMain.toString()})(window, tok);
})();
`;
}
