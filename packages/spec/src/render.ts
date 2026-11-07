/**
 * Renders a validated app spec as a labelled screen tree (role + name on every node) and as HTML,
 * in Android style or iPhone style. Theme tokens drive colours, radius, spacing and type.
 */
import { validate } from "./validate.js";
import { evaluate, evaluateTemplate } from "./eval.js";
import type { EvalOptions } from "./eval.js";
import type { Issue } from "./types.js";

export type PhoneStyle = "android" | "ios";

/** One node of the screen tree. Every node has a role; nodes a person or agent can read or use have a name. */
export interface ScreenNode {
  role: string;
  name: string;
  /** The block that produced this node, such as "stack" or "list". */
  block: string;
  children: ScreenNode[];
  /** Visual details for the HTML output. */
  props?: Record<string, unknown>;
}

export interface RenderOptions extends EvalOptions {
  style?: PhoneStyle;
  /** Screen id. Default: the first screen. */
  screen?: string;
  /** Values for `http` and `collection` data sources, by name. Computed sources are evaluated. */
  data?: Record<string, unknown>;
  /** Overrides for state defaults. */
  state?: Record<string, unknown>;
  /** Route params for the screen. */
  params?: Record<string, unknown>;
  /** Form values typed so far, by form key (the block's `id`, or its `label`), then field name. Set by {@link createApp}. */
  drafts?: Record<string, Record<string, unknown>>;
  /** Validation messages to show, by form key, then field name. Set by {@link createApp}. */
  fieldErrors?: Record<string, Record<string, string>>;
  /** Shows a Back button first on the screen. Set by {@link createApp}. */
  canGoBack?: boolean;
  /** The tab that is selected. Default: the screen. Set by {@link createApp}. */
  tab?: string;
  /** A message to show last, such as the result of an action. Set by {@link createApp}. */
  toast?: string;
}

export type RenderResult =
  | { ok: true; style: PhoneStyle; title: string; tree: ScreenNode; html: string; warnings: Issue[] }
  | { ok: false; errors: Issue[] };

type Obj = Record<string, any>;
const GAPS: Record<string, number> = { none: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
const RADII: Record<string, number> = { none: 0, sm: 4, md: 8, lg: 12, xl: 20, full: 999 };
const DENSITY: Record<string, number> = { compact: 0.75, comfortable: 1, spacious: 1.25 };
const DEFAULT_PALETTE = { primary: "#0B5FFF", accent: "#C2410C", background: "#FFFFFF", surface: "#F3F4F6", text: "#111827", muted: "#4B5563", danger: "#B91C1C", success: "#047857" };
const DARK_PALETTE = { primary: "#7CB0FF", accent: "#FF9A7A", background: "#0B0F14", surface: "#141A22", text: "#F3F6F9", muted: "#A5B0BF", danger: "#FF8A95", success: "#5BE3A8" };
const VARIANT_SIZE: Record<string, number> = { display: 32, title: 22, body: 16, caption: 13, mono: 14 };

/** Renders one screen. Invalid specs are refused with the validator's errors. */
export function renderScreen(spec: unknown, options: RenderOptions = {}): RenderResult {
  return renderInternal(spec, options).result;
}

export interface Registered { kind: "button" | "form"; block: Obj; scope: Record<string, unknown> }
export interface Internal { result: RenderResult; scope: () => Record<string, unknown>; registry: Map<string, Registered> }

export function renderInternal(spec: unknown, options: RenderOptions): Internal {
  const registry = new Map<string, Registered>();
  const fail = (errors: Issue[]): Internal => ({ result: { ok: false, errors }, scope: () => ({}), registry });
  const { errors, warnings } = validate(spec);
  if (errors.length) return fail(errors);
  const s = spec as Obj;
  const style: PhoneStyle = options.style ?? "android";
  const screen: Obj | undefined = options.screen ? s.screens.find((x: Obj) => x.id === options.screen) : s.screens[0];
  if (!screen) {
    return fail([{ path: "$.screens", message: `There is no screen "${options.screen}".`, fix: `Use one of: ${s.screens.map((x: Obj) => x.id).join(", ")}.` }]);
  }

  const state: Record<string, unknown> = {};
  for (const [k, v] of Object.entries<Obj>(s.state ?? {})) state[k] = v.default ?? null;
  Object.assign(state, options.state);
  const data: Record<string, unknown> = { ...options.data };
  for (const [k, v] of Object.entries<Obj>(s.data ?? {})) {
    if (v.source === "collection" && !(k in data)) data[k] = v.seed ?? [];
  }
  const base = () => ({ ...data, data, state, route: { params: options.params ?? {} } });
  for (const [k, v] of Object.entries<Obj>(s.data ?? {})) {
    if (v.source === "computed") {
      try { data[k] = evaluateTemplate(String(v.value), base(), options); } catch { data[k] = null; }
    }
  }

  const tpl = (text: unknown, scope: Record<string, unknown>): unknown => {
    if (typeof text !== "string" || !text.includes("{{")) return text;
    try { return evaluateTemplate(text, scope, options); } catch { return ""; }
  };
  const str = (text: unknown, scope: Record<string, unknown>) => {
    const v = tpl(text, scope);
    return v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  };

  const build = (b: Obj, scope: Record<string, unknown>): ScreenNode | undefined => {
    if (typeof b.when === "string") {
      try { if (!evaluate(b.when.replace(/^\{\{\s*|\s*\}\}$/g, ""), scope, options)) return undefined; } catch { return undefined; }
    }
    const kids = () => (b.children ?? []).map((c: Obj) => build(c, scope)).filter(Boolean) as ScreenNode[];
    const label = typeof b.label === "string" ? str(b.label, scope) : "";
    switch (b.type) {
      case "stack":
        return { role: "group", name: label, block: "stack", children: kids(), props: { direction: b.direction === "horizontal" ? "row" : "column", gap: b.gap, align: b.align } };
      case "grid":
        return { role: "grid", name: label, block: "grid", children: kids(), props: { columns: Number(b.columns) > 0 ? Number(b.columns) : 2, gap: b.gap } };
      case "scroll":
        return { role: "region", name: label || "Scrollable area", block: "scroll", children: kids() };
      case "text": {
        const variant = String(b.variant ?? "body");
        const value = str(b.value ?? b.text, scope);
        return { role: variant === "display" || variant === "title" ? "heading" : "paragraph", name: value, block: "text", children: [], props: { variant } };
      }
      case "image": {
        const name = label || str(b.alt, scope) || "Image";
        return { role: "img", name, block: "image", children: [], props: { src: typeof b.src === "string" ? str(b.src, scope) : "", height: b.height } };
      }
      case "icon": {
        const icon = str(b.name ?? b.icon, scope);
        return { role: "img", name: label || icon || "Icon", block: "icon", children: [], props: { icon } };
      }
      case "badge": {
        const value = str(b.value ?? b.text, scope);
        return { role: "status", name: label || value, block: "badge", children: [], props: { text: value, tone: b.tone ?? b.variant } };
      }
      case "list":
        return buildList(b, scope, label);
      case "button": {
        const key = String(b.id ?? b.label);
        registry.set(`button:${key}`, { kind: "button", block: b, scope });
        return { role: "button", name: label, block: "button", children: [], props: { variant: b.variant ?? "primary", key } };
      }
      case "form":
        return buildForm(b, scope, label);
      default:
        return undefined; // other blocks arrive in later slices
    }
  };

  const buildList = (b: Obj, scope: Record<string, unknown>, label: string): ScreenNode => {
    let items: unknown = [];
    if (typeof b.from === "string") {
      items = b.from.includes("{{") ? tpl(b.from, scope) : scope[b.from];
    }
    const list = Array.isArray(items) ? items : [];
    const name = label || "List";
    if (!list.length) {
      const msg = str(b.empty?.message, scope);
      return { role: "list", name, block: "list", children: msg ? [{ role: "status", name: msg, block: "empty", children: [] }] : [] };
    }
    const tmpl: Obj = b.item ?? {};
    const rows = list.map((item): ScreenNode => {
      const sc = { ...scope, item };
      const title = str(tmpl.title, sc), subtitle = str(tmpl.subtitle, sc), trailing = str(tmpl.trailing, sc);
      return {
        role: "listitem", name: [title, subtitle, trailing].filter(Boolean).join(", "), block: "item", children: [],
        props: { title, subtitle, trailing, leading: str(tmpl.leading, sc) }
      };
    });
    return { role: "list", name, block: "list", children: rows };
  };

  const buildForm = (b: Obj, scope: Record<string, unknown>, label: string): ScreenNode => {
    const key = String(b.id ?? b.label);
    registry.set(`form:${key}`, { kind: "form", block: b, scope });
    const draft = options.drafts?.[key] ?? {};
    const errs = options.fieldErrors?.[key] ?? {};
    const kids: ScreenNode[] = [];
    for (const f of formFields(b)) {
      const name = str(f.label ?? f.name, scope);
      const value = f.name in draft ? draft[f.name] : fieldDefault(f);
      const props = { field: f.name, type: f.type, required: f.required === true, value };
      const error = errs[f.name];
      const base: Pick<ScreenNode, "children"> = { children: [] };
      if (f.type === "choice") {
        const opts = (f.options ?? []).map(String);
        kids.push({ role: "radiogroup", name, block: "field", props, children: opts.map((o) => ({ role: "radio", name: o, block: "option", children: [], props: { checked: value === o } })) });
      } else if (f.type === "toggle") {
        kids.push({ role: "switch", name, block: "field", ...base, props: { ...props, checked: value === true } });
      } else {
        kids.push({ role: f.type === "number" ? "spinbutton" : "textbox", name, block: "field", ...base, props });
      }
      if (error) kids.push({ role: "alert", name: error, block: "error", children: [] });
    }
    const submit = b.submit ?? {};
    kids.push({ role: "button", name: str(submit.label ?? "Submit", scope), block: "submit", children: [], props: { key, action: submit.action } });
    return { role: "form", name: label, block: "form", children: kids, props: { key } };
  };

  const children = (screen.body as Obj[]).map((b) => build(b, base())).filter(Boolean) as ScreenNode[];
  const nav = s.navigation?.type === "tabs" && Array.isArray(s.navigation.items) ? (s.navigation.items as Obj[]) : [];
  const selectedTab = options.tab ?? screen.id;
  if (options.canGoBack) children.unshift({ role: "button", name: "Back", block: "back", children: [] });
  if (nav.length) {
    const tabs = nav.map((it): ScreenNode => {
      const target = s.screens.find((x: Obj) => x.id === it.screen);
      const name = str(it.label ?? target?.title ?? it.screen, base());
      return { role: "tab", name, block: "tab", children: [], props: { screen: it.screen, icon: it.icon, selected: it.screen === selectedTab } };
    });
    children.push({ role: "tablist", name: "Tabs", block: "tabs", children: tabs });
  }
  if (options.toast) children.push({ role: "status", name: options.toast, block: "toast", children: [] });
  const title = str(screen.title ?? s.app?.name ?? "", base());
  const tree: ScreenNode = { role: "main", name: title || s.app?.name || "Screen", block: "screen", children };
  const tokens = themeTokens(s.theme ?? {}, style);
  const result: RenderResult = { ok: true, style, title: tree.name, tree, html: toHtml(tree, tokens, style, String(s.app?.name ?? "")), warnings };
  return { result, scope: base, registry };
}

export interface FormField { name: string; type: string; label?: string; required?: boolean; options?: unknown[]; default?: unknown; min?: number; max?: number; minLength?: number; maxLength?: number; pattern?: string; message?: string }

export function formFields(b: Obj): FormField[] {
  return (Array.isArray(b.fields) ? b.fields : []).filter((f: Obj) => f && typeof f.name === "string" && typeof f.type === "string");
}

export function fieldDefault(f: FormField): unknown {
  if (f.default !== undefined) return f.default;
  return f.type === "toggle" ? false : "";
}

/** The tree as plain indented text, one node per line: `role "name"`. Useful for tests and agents. */
export function describeTree(node: ScreenNode, depth = 0): string {
  const line = `${"  ".repeat(depth)}${node.role} ${JSON.stringify(node.name)}`;
  return [line, ...node.children.map((c) => describeTree(c, depth + 1))].join("\n");
}

/**
 * The tree in the simulator's screen format (what `@shipvo/test` parses): `- role "name" [ref=e1]`,
 * two spaces per level, refs numbered in reading order. Layout-only nodes without a name have no quotes.
 */
export function toSnapshot(root: ScreenNode): string {
  let n = 0;
  const lines: string[] = [];
  const walk = (node: ScreenNode, depth: number) => {
    const name = node.name ? ` "${node.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : "";
    lines.push(`${"  ".repeat(depth)}- ${node.role}${name} [ref=e${++n}]`);
    for (const c of node.children) walk(c, depth + 1);
  };
  walk(root, 0);
  return lines.join("\n");
}

/** Every node with no role or no name where one is needed (all except plain layout groups). */
export function unlabelled(node: ScreenNode): ScreenNode[] {
  const own = !node.role || (!node.name && !["group", "grid", "main"].includes(node.role)) ? [node] : [];
  return [...own, ...node.children.flatMap(unlabelled)];
}

interface Tokens { p: typeof DEFAULT_PALETTE; radius: number; unit: number; scale: number; font: string; display: string; dark: boolean; shadow: string }

/** Keeps letters, digits, space, `-` and `_`. Anything else is dropped, so a font name cannot leave its quotes. */
function fontName(v: unknown): string {
  return typeof v === "string" ? v.replace(/[^A-Za-z0-9 _-]/g, "").trim() : "";
}

function themeTokens(theme: Obj, style: PhoneStyle): Tokens {
  const dark = theme.mode === "dark";
  const p = { ...(dark ? DARK_PALETTE : DEFAULT_PALETTE), ...(theme.palette ?? {}) };
  const family = fontName(theme.font?.family);
  const display = fontName(theme.font?.display);
  const sys = style === "ios" ? "-apple-system, 'SF Pro Text', system-ui, sans-serif" : "Roboto, system-ui, sans-serif";
  // iPhone style rounds a little more; Android style uses the token as written.
  const radius = (RADII[theme.radius as string] ?? RADII.md!) * (style === "ios" ? 1.25 : 1);
  const shadows: Record<string, string> = { flat: "none", soft: "0 1px 3px rgba(0,0,0,.18)", raised: "0 4px 12px rgba(0,0,0,.28)" };
  // Every value below goes into a style="..." attribute, so each one is escaped.
  const safeP = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, esc(v)])) as typeof DEFAULT_PALETTE;
  return {
    p: safeP, radius, unit: DENSITY[theme.density as string] ?? 1, scale: Number(theme.font?.scale) || 1,
    font: esc(family ? `'${family}', ${sys}` : sys), display: esc(display ? `'${display}', ${sys}` : sys),
    dark, shadow: shadows[theme.elevation as string] ?? shadows.soft!
  };
}

const esc = (t: unknown) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const safeSrc = (u: string) => (/^(https:\/\/|data:image\/)/i.test(u) ? u : "");

function toHtml(root: ScreenNode, t: Tokens, style: PhoneStyle, appName: string): string {
  const gap = (g: unknown) => Math.round((GAPS[String(g ?? "md")] ?? GAPS.md!) * t.unit);
  const node = (n: ScreenNode): string => {
    const a = `role="${n.role}"${n.name ? ` aria-label="${esc(n.name)}"` : ""}`;
    const pr = n.props ?? {};
    const inner = n.children.map(node).join("");
    switch (n.block) {
      case "stack":
        return `<div ${a} style="display:flex;flex-direction:${pr.direction};gap:${gap(pr.gap)}px;${pr.align ? `align-items:${pr.align === "center" ? "center" : pr.align === "end" ? "flex-end" : "flex-start"};` : ""}">${inner}</div>`;
      case "grid":
        return `<div ${a} style="display:grid;grid-template-columns:repeat(${pr.columns},1fr);gap:${gap(pr.gap)}px">${inner}</div>`;
      case "scroll":
        return `<div ${a} tabindex="0" style="overflow:auto;display:flex;flex-direction:column;gap:${gap("md")}px">${inner}</div>`;
      case "text": {
        const v = String(pr.variant);
        const size = Math.round((VARIANT_SIZE[v] ?? 16) * t.scale);
        const color = v === "caption" ? t.p.muted : t.p.text;
        const fam = v === "display" || v === "title" ? t.display : v === "mono" ? "ui-monospace, monospace" : t.font;
        const tag = n.role === "heading" ? "h2" : "p";
        return `<${tag} style="margin:0;font:${v === "display" || v === "title" ? 700 : 400} ${size}px/1.3 ${fam};color:${color}">${esc(n.name)}</${tag}>`;
      }
      case "image": {
        const src = safeSrc(String(pr.src ?? ""));
        const h = Number(pr.height) || 140;
        return src
          ? `<img role="img" alt="${esc(n.name)}" src="${esc(src)}" style="width:100%;height:${h}px;object-fit:cover;border-radius:${t.radius}px">`
          : `<div ${a} style="height:${h}px;background:${t.p.surface};border-radius:${t.radius}px"></div>`;
      }
      case "icon":
        return `<span ${a} style="display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:${t.p.surface};color:${t.p.primary};font:700 13px ${t.font}">${esc(String(pr.icon || "?").slice(0, 1).toUpperCase())}</span>`;
      case "badge": {
        const color = pr.tone === "danger" ? t.p.danger : pr.tone === "success" ? t.p.success : t.p.primary;
        return `<span ${a} style="display:inline-block;padding:2px 10px;border-radius:999px;background:${t.p.surface};color:${color};border:1px solid ${color};font:600 12px ${t.font}">${esc(pr.text)}</span>`;
      }
      case "list": {
        const ios = style === "ios";
        const wrap = ios ? `background:${t.p.surface};border-radius:${t.radius}px;overflow:hidden` : "";
        return `<div ${a} style="${wrap}">${inner}</div>`;
      }
      case "item": {
        const sep = `border-bottom:${style === "ios" ? "0.5px" : "1px"} solid ${t.dark ? "#ffffff22" : "#00000018"}`;
        const pad = Math.round(12 * t.unit);
        return `<div ${a} style="display:flex;align-items:center;gap:12px;padding:${pad}px ${style === "ios" ? 16 : 8}px;${sep}"><div style="flex:1;min-width:0"><div style="font:${style === "ios" ? 500 : 400} ${Math.round(16 * t.scale)}px ${t.font};color:${t.p.text}">${esc(pr.title)}</div>${pr.subtitle ? `<div style="font:400 ${Math.round(13 * t.scale)}px ${t.font};color:${t.p.muted}">${esc(pr.subtitle)}</div>` : ""}</div>${pr.trailing ? `<div style="font:600 ${Math.round(15 * t.scale)}px ${t.font};color:${t.p.text}">${esc(pr.trailing)}</div>` : ""}</div>`;
      }
      case "button": {
        const filled = pr.variant !== "secondary" && pr.variant !== "ghost";
        const color = pr.variant === "danger" ? t.p.danger : t.p.primary;
        return `<button type="button" ${a} style="min-height:44px;padding:0 20px;border-radius:${t.radius}px;border:${filled ? "0" : `1px solid ${color}`};background:${filled ? color : "transparent"};color:${filled ? t.p.background : color};font:600 ${Math.round(16 * t.scale)}px ${t.font}">${esc(n.name)}</button>`;
      }
      case "submit":
      case "back":
        return `<button type="button" ${a} style="min-height:44px;padding:0 20px;border-radius:${t.radius}px;border:${n.block === "back" ? `1px solid ${t.p.primary}` : "0"};background:${n.block === "back" ? "transparent" : t.p.primary};color:${n.block === "back" ? t.p.primary : t.p.background};font:600 ${Math.round(16 * t.scale)}px ${t.font}">${esc(n.name)}</button>`;
      case "form":
        return `<form ${a} onsubmit="return false" style="display:flex;flex-direction:column;gap:${gap("md")}px">${inner}</form>`;
      case "field": {
        const lab = `font:500 ${Math.round(14 * t.scale)}px ${t.font};color:${t.p.text}`;
        const box = `min-height:44px;box-sizing:border-box;padding:0 12px;border-radius:${t.radius}px;border:1px solid ${t.p.muted};background:${t.p.background};color:${t.p.text};font:400 ${Math.round(16 * t.scale)}px ${t.font}`;
        if (n.role === "radiogroup") return `<fieldset ${a} style="border:0;padding:0;margin:0"><legend style="${lab}">${esc(n.name)}</legend>${inner}</fieldset>`;
        if (n.role === "switch") return `<label style="${lab};display:flex;align-items:center;gap:8px;min-height:44px"><input type="checkbox" role="switch" aria-label="${esc(n.name)}"${pr.checked ? " checked" : ""}>${esc(n.name)}</label>`;
        const kind = pr.type === "number" ? "number" : pr.type === "date" ? "date" : "text";
        return `<label style="${lab};display:flex;flex-direction:column;gap:4px">${esc(n.name)}<input type="${kind}" aria-label="${esc(n.name)}" value="${esc(pr.value ?? "")}" style="${box}"></label>`;
      }
      case "option":
        return `<label style="display:flex;align-items:center;gap:8px;min-height:44px;font:400 ${Math.round(16 * t.scale)}px ${t.font};color:${t.p.text}"><input type="radio" aria-label="${esc(n.name)}"${pr.checked ? " checked" : ""}>${esc(n.name)}</label>`;
      case "error":
      case "toast":
        return `<p ${a} style="margin:0;font:500 ${Math.round(14 * t.scale)}px ${t.font};color:${n.block === "error" ? t.p.danger : t.p.success}">${esc(n.name)}</p>`;
      case "tabs":
        return `<nav ${a} style="display:flex;justify-content:space-around;border-top:1px solid ${t.dark ? "#ffffff22" : "#00000018"};padding-top:8px">${inner}</nav>`;
      case "tab":
        return `<span ${a} aria-selected="${pr.selected === true}" style="min-height:44px;display:inline-flex;align-items:center;padding:0 12px;font:${pr.selected ? 700 : 400} ${Math.round(14 * t.scale)}px ${t.font};color:${pr.selected ? t.p.primary : t.p.muted}">${esc(n.name)}</span>`;
      case "empty":
        return `<p ${a} style="margin:0;padding:24px;text-align:center;font:400 14px ${t.font};color:${t.p.muted}">${esc(n.name)}</p>`;
      default:
        return inner;
    }
  };
  const ios = style === "ios";
  const bar = ios
    ? `<header style="padding:54px 16px 10px;text-align:center;font:600 17px ${t.font};color:${t.p.text}">${esc(root.name)}</header>`
    : `<header style="padding:40px 16px 14px;font:500 22px ${t.font};color:${t.p.text};background:${t.p.surface};box-shadow:${t.shadow}">${esc(root.name)}</header>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(appName || root.name)}</title><style>[tabindex]:focus-visible{outline:2px solid ${t.p.primary};outline-offset:2px}</style></head>
<body data-style="${style}" style="margin:0;background:${t.p.background}"><main role="main" aria-label="${esc(root.name)}" style="min-height:100vh;box-sizing:border-box;background:${t.p.background}">${bar}<div style="padding:16px;display:flex;flex-direction:column;gap:${gap("md")}px">${root.children.map(node).join("")}</div></main></body></html>`;
}
