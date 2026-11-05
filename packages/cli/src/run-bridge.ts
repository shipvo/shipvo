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
  const refs = new WeakMap<object, number>();
  let counter = 0;
  const refOf = (el: object) => { let n = refs.get(el); if (!n) { n = ++counter; refs.set(el, n); } return "e" + n; };

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
      const key = role + (name ? " " + quote(name) : "") + states(el, role) + " [ref=" + refOf(el) + "]";
      if (tag === "input" || tag === "textarea") { const v = el.value; out.push(keyLine(pad, key, v && !/^(checkbox|radio|button|submit|reset)$/.test(el.type) ? ": " + val(v) : "")); return; }
      if (fromContent || tag === "img") { out.push(keyLine(pad, key, "")); return; }
      const mark = out.length; out.push("");
      for (const c of el.childNodes) child(c, depth + 1, out);
      out[mark] = keyLine(pad, key, out.length > mark + 1 ? ":" : "");
      return;
    }
    // No role: keep the text, drop the wrapper. A wrapper with only text becomes one generic line.
    const hasEl = [...el.children].length > 0;
    if (!hasEl) { const t = norm(el.textContent); if (t) out.push(pad + "- generic [ref=" + refOf(el) + "]: " + val(t)); return; }
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

  const ws = new win.WebSocket((win.location.protocol === "https:" ? "wss://" : "ws://") + win.location.host + "/__shipvo/agent?role=screen&token=" + encodeURIComponent(token));
  ws.onmessage = (e: any) => {
    let m: any; try { m = JSON.parse(String(e.data)); } catch { return; }
    if (!m || typeof m.id !== "number") return;
    try {
      if (m.type === "tree") ws.send(JSON.stringify({ id: m.id, type: "tree", ok: true, tree: tree() }));
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
