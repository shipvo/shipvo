/**
 * Renders a validated app spec as a labelled screen tree (role + name on every node) and as HTML,
 * in Android style or iPhone style. Theme tokens drive colours, radius, spacing and type.
 */
import { validate } from "./validate.js";
import { evaluate, evaluateTemplate } from "./eval.js";
import type { EvalOptions } from "./eval.js";
import type { Issue } from "./types.js";
import { aggregatePoints, chartSvg, chartText } from "./chart.js";
import { resolveShapes, vectorSvg } from "./vector.js";
import type { Shape } from "./vector.js";
import type { Aggregate, ChartKind, ChartPoint } from "./chart.js";

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
  /** The person's language, such as "fr". Text that matches a key in `strings[language]` is translated. Default: the language of `locale`, else "en". */
  language?: string;
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
  /** Shows the screen as a bottom sheet. Screens with `"presentation": "sheet"` are always shown that way. Set by {@link createApp}. */
  sheet?: boolean;
  /** The phone's reduce-motion setting. When true, no node carries animation fields. */
  reduceMotion?: boolean;
  /** A message to show last, such as the result of an action. Set by {@link createApp}. */
  toast?: string;
}

const RTL = new Set(["ar", "he", "fa", "ur", "yi", "ps", "sd", "ug", "dv", "ckb"]);

/** "rtl" for right-to-left languages such as Arabic and Hebrew, else "ltr". Accepts "ar", "he-IL", "ar_EG". */
export function textDirection(tag: string): "ltr" | "rtl" {
  const lang = tag.toLowerCase().split(/[-_]/)[0] ?? "";
  return RTL.has(lang === "iw" ? "he" : lang) ? "rtl" : "ltr";
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

export interface Registered { kind: "button" | "form" | "toggle" | "segmented" | "card"; block: Obj; scope: Record<string, unknown> }
export interface Internal { result: RenderResult; scope: () => Record<string, unknown>; registry: Map<string, Registered> }

export function renderInternal(spec: unknown, options: RenderOptions): Internal {
  const registry = new Map<string, Registered>();
  const fail = (errors: Issue[]): Internal => ({ result: { ok: false, errors }, scope: () => ({}), registry });
  const { errors, warnings } = validate(spec);
  if (errors.length) return fail(errors);
  const s = spec as Obj;
  const style: PhoneStyle = options.style ?? "android";
  const language = options.language ?? options.locale?.split(/[-_]/)[0] ?? "en";
  if (!options.locale && options.language) options = { ...options, locale: options.language };
  const table: Record<string, string> = s.strings && typeof s.strings[language] === "object" && s.strings[language] ? s.strings[language] : {};
  const translate = (t: string) => (Object.prototype.hasOwnProperty.call(table, t) ? table[t]! : t);
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
    if (typeof text === "string" && Object.prototype.hasOwnProperty.call(table, text)) return table[text]!;
    const v = tpl(text, scope);
    return v === null || v === undefined ? "" : typeof v === "object" ? translate(JSON.stringify(v)) : translate(String(v));
  };

  const bound = (b: Obj): unknown => (typeof b.bind === "string" ? state[b.bind.replace(/^state\./, "")] : undefined);

  const motionOn = (s.theme?.motion ?? "calm") !== "none" && options.reduceMotion !== true;
  const duration = s.theme?.motion === "lively" ? 400 : 240;
  const build = (b: Obj, scope: Record<string, unknown>): ScreenNode | undefined => {
    const node = buildBlock(b, scope);
    if (node && motionOn && b.motion && typeof b.motion === "object" && (b.motion.enter || b.motion.change)) {
      const m: Record<string, unknown> = { duration };
      if (b.motion.enter) m.enter = b.motion.enter;
      if (b.motion.change) { m.change = b.motion.change; m.to = node.props?.value ?? node.name; }
      node.props = { ...node.props, motion: m };
    }
    return node;
  };

  const buildBlock = (b: Obj, scope: Record<string, unknown>): ScreenNode | undefined => {
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
      case "section": {
        const title = str(b.title ?? b.label, scope);
        return { role: "region", name: title, block: "section", children: kids() };
      }
      case "card":
        return { role: "group", name: label, block: "card", children: kids(), props: { variant: b.variant ?? "plain" } };
      case "divider":
        return { role: "separator", name: "", block: "divider", children: [] };
      case "stat": {
        const value = str(b.value, scope), delta = str(b.delta, scope);
        const trend = typeof b.trend === "string" ? b.trend : delta.startsWith("-") ? "down" : delta.startsWith("+") ? "up" : "";
        const name = `${label}: ${value}${delta ? `, ${delta}` : ""}`;
        return { role: "status", name, block: "stat", children: [], props: { label, value, delta, trend, variant: b.variant } };
      }
      case "progress": {
        const max = Number(b.max) > 0 ? Number(b.max) : 100;
        const raw = Number(tpl(b.value, scope));
        const pct = Math.round(Math.min(1, Math.max(0, Number.isFinite(raw) ? raw / max : 0)) * 100);
        return { role: "progressbar", name: `${label || "Progress"}: ${pct}%`, block: "progress", children: [], props: { pct, shape: b.variant === "ring" ? "ring" : "bar" } };
      }
      case "toggle": {
        const key = String(b.id ?? b.label);
        registry.set(`toggle:${key}`, { kind: "toggle", block: b, scope });
        const on = bound(b) === true;
        return { role: "switch", name: `${label}: ${on ? "on" : "off"}`, block: "toggle", children: [], props: { checked: on, label, key } };
      }
      case "segmented": {
        const key = String(b.id ?? b.label);
        registry.set(`segmented:${key}`, { kind: "segmented", block: b, scope });
        const cur = bound(b);
        const opts = (Array.isArray(b.options) ? b.options : []).map(String);
        const opt = (o: string): ScreenNode => ({ role: "radio", name: o, block: "segment", children: [], props: { checked: cur === o } });
        return { role: "radiogroup", name: `${label}: ${cur === null || cur === undefined ? "none" : String(cur)}`, block: "segmented", children: opts.map(opt), props: { label, key } };
      }
      case "list":
        return buildList(b, scope, label);
      case "chart":
        return buildChart(b, scope, label);
      case "kanban":
        return buildKanban(b, scope, label);
      case "timeline":
        return buildTimeline(b, scope, label);
      case "vector": {
        const width = Number(b.width) > 0 ? Number(b.width) : 100, height = Number(b.height) > 0 ? Number(b.height) : 100;
        const shapes = resolveShapes(b.shapes, (v) => (typeof v === "string" && v.includes("{{") ? tpl(v, scope) : v));
        const value = b.value === undefined ? undefined : tpl(b.value, scope);
        const name = value === undefined || value === null ? label : `${label}: ${text(value)}`;
        return { role: "img", name, block: "vector", children: [], props: { width, height, value, shapes } };
      }
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

  /** A template or a bare expression, evaluated per item. */
  const each = (src: unknown, sc: Record<string, unknown>): unknown => {
    if (typeof src !== "string") return "";
    if (src.includes("{{")) return tpl(src, sc);
    try { return evaluate(src, sc, options); } catch { return src; }
  };
  const text = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  const itemsOf = (b: Obj, scope: Record<string, unknown>): unknown[] => {
    const items = typeof b.from === "string" ? (b.from.includes("{{") ? tpl(b.from, scope) : scope[b.from]) : [];
    return Array.isArray(items) ? items : [];
  };

  const buildKanban = (b: Obj, scope: Record<string, unknown>, label: string): ScreenNode => {
    const cols: string[] = (Array.isArray(b.columns) ? b.columns : []).map(String);
    const items = itemsOf(b, scope);
    const movable = typeof b.onMove?.action === "string";
    const children = cols.map((col): ScreenNode => {
      const cards = items.filter((item) => text(each(b.column, { ...scope, item })) === col).map((item): ScreenNode => {
        const sc = { ...scope, item };
        const title = str(b.title, sc), detail = str(b.detail, sc);
        const key = title;
        if (movable) registry.set(`card:${key}`, { kind: "card", block: b, scope: sc });
        return { role: "listitem", name: [title, detail].filter(Boolean).join(", "), block: "kcard", children: [], props: { title, detail, column: col, key } };
      });
      return { role: "group", name: `${col}, ${cards.length} ${cards.length === 1 ? "card" : "cards"}`, block: "column", children: cards, props: { title: col } };
    });
    return { role: "group", name: label || "Board", block: "kanban", children, props: { columns: cols.length } };
  };

  const buildTimeline = (b: Obj, scope: Record<string, unknown>, label: string): ScreenNode => {
    const entries = itemsOf(b, scope).map((item) => {
      const sc = { ...scope, item };
      const date = text(each(b.date, sc));
      return { date, day: date.slice(0, 10), title: str(b.title, sc), detail: str(b.detail, sc) };
    }).filter((e) => /^\d{4}-\d{2}-\d{2}/.test(e.date));
    // Newest day first; entries keep their order within a day.
    const days = [...new Set(entries.map((e) => e.day))].sort().reverse();
    const children = days.map((day): ScreenNode => ({
      role: "group", name: day, block: "day", props: { day },
      children: entries.filter((e) => e.day === day).map((e): ScreenNode => ({
        role: "listitem", name: [e.title, e.detail].filter(Boolean).join(", "), block: "entry", children: [], props: { title: e.title, detail: e.detail, time: e.date.length > 10 ? e.date.slice(11, 16) : "" }
      }))
    }));
    const empty = str(b.empty?.message, scope);
    return { role: "list", name: label || "Timeline", block: "timeline", children: children.length || !empty ? children : [{ role: "status", name: empty, block: "empty", children: [] }] };
  };

  const buildChart = (b: Obj, scope: Record<string, unknown>, label: string): ScreenNode => {
    let items: unknown = [];
    if (typeof b.from === "string") items = b.from.includes("{{") ? tpl(b.from, scope) : scope[b.from];
    let points: ChartPoint[] = (Array.isArray(items) ? items : []).map((item) => {
      const sc = { ...scope, item };
      const y = Number(each(b.y, sc));
      const x = each(b.x, sc);
      const sr = b.series === undefined ? "" : each(b.series, sc);
      return { x: x === null || x === undefined ? "" : String(x), y: Number.isFinite(y) ? y : 0, series: sr === null || sr === undefined ? "" : String(sr) };
    });
    if (typeof b.aggregate === "string") points = aggregatePoints(points, b.aggregate as Aggregate);
    const name = chartText(label || "Chart", points);
    return { role: "img", name, block: "chart", children: [], props: { kind: b.kind as ChartKind, points } };
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
  const asSheet = options.sheet === true || screen.presentation === "sheet";
  const nav = !asSheet && s.navigation?.type === "tabs" && Array.isArray(s.navigation.items) ? (s.navigation.items as Obj[]) : [];
  const selectedTab = options.tab ?? screen.id;
  if (asSheet) {
    const sheetTitle = str(screen.title ?? "", base()) || "Sheet";
    const sheet: ScreenNode = { role: "dialog", name: sheetTitle, block: "sheet", children: [...children, { role: "button", name: "Close", block: "back", children: [] }] };
    children.splice(0, children.length, sheet);
  } else if (options.canGoBack) children.unshift({ role: "button", name: "Back", block: "back", children: [] });
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
  const dir = textDirection(options.locale ?? language);
  const tree: ScreenNode = { role: "main", name: title || s.app?.name || "Screen", block: "screen", children, props: { dir, language } };
  const tokens = themeTokens(s.theme ?? {}, style);
  const result: RenderResult = { ok: true, style, title: tree.name, tree, html: toHtml(tree, tokens, style, String(s.app?.name ?? ""), language, dir), warnings };
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
  const own = !node.role || (!node.name && !["group", "grid", "main", "separator"].includes(node.role)) ? [node] : [];
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

function toHtml(root: ScreenNode, t: Tokens, style: PhoneStyle, appName: string, language = "en", dir = "ltr"): string {
  const gap = (g: unknown) => Math.round((GAPS[String(g ?? "md")] ?? GAPS.md!) * t.unit);
  const ios = style === "ios";
  const node = (n: ScreenNode): string => {
    const m = n.props?.motion as Record<string, unknown> | undefined;
    const html = plain(n);
    if (!m) return html;
    const anim = [m.enter ? `sv-${esc(m.enter)} ${m.duration}ms ease-out both` : "", m.change === "pulse" ? `sv-pulse ${m.duration}ms ease-out` : ""].filter(Boolean).join(",");
    return `<div${m.change ? ` data-change="${esc(m.change)}" data-to="${esc(m.to)}"` : ""} style="${anim ? `animation:${anim}` : ""}">${html}</div>`;
  };
  const plain = (n: ScreenNode): string => {
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
      case "section":
        return `<section ${a} style="display:flex;flex-direction:column;gap:${gap("sm")}px"><h3 style="margin:0;font:${ios ? "600 13px" : "500 14px"} ${t.font};color:${t.p.muted};${ios ? "text-transform:uppercase;letter-spacing:.04em" : ""}">${esc(n.name)}</h3>${inner}</section>`;
      case "card": {
        const v = String(pr.variant);
        const bg = v === "filled" ? t.p.surface : v === "outlined" ? "transparent" : t.p.background;
        const border = v === "outlined" ? `1px solid ${t.dark ? "#ffffff33" : "#00000026"}` : "0";
        const shadow = v === "plain" && !ios ? t.shadow : "none";
        return `<div ${a} style="padding:${Math.round(16 * t.unit)}px;border-radius:${Math.round(t.radius * (ios ? 1.2 : 1.4))}px;background:${bg};border:${border};box-shadow:${shadow};display:flex;flex-direction:column;gap:${gap("sm")}px">${inner}</div>`;
      }
      case "divider":
        return `<hr role="separator" style="width:100%;border:0;margin:0;${ios ? "margin-left:16px;height:0.5px" : "height:1px"};background:${t.dark ? "#ffffff22" : "#00000018"}">`;
      case "stat": {
        const hero = pr.variant === "hero";
        const col = pr.trend === "down" ? t.p.danger : pr.trend === "up" ? t.p.success : t.p.muted;
        const arrow = pr.trend === "down" ? "▼ " : pr.trend === "up" ? "▲ " : "";
        return `<div ${a} style="display:flex;flex-direction:column;gap:2px"><span style="font:400 ${Math.round(13 * t.scale)}px ${t.font};color:${t.p.muted}">${esc(pr.label)}</span><span style="font:700 ${Math.round((hero ? 36 : 24) * t.scale)}px ${t.display};color:${t.p.text}">${esc(pr.value)}</span>${pr.delta ? `<span style="font:600 ${Math.round(13 * t.scale)}px ${t.font};color:${col}">${arrow}${esc(pr.delta)}</span>` : ""}</div>`;
      }
      case "progress": {
        const pct = Number(pr.pct);
        if (pr.shape === "ring") {
          const sw = ios ? 4 : 6, r = 20 - sw / 2, c = +(2 * Math.PI * r).toFixed(2);
          return `<svg ${a} aria-valuenow="${pct}" width="48" height="48" viewBox="0 0 40 40"><circle cx="20" cy="20" r="${r}" fill="none" stroke="${t.p.surface}" stroke-width="${sw}"/><circle cx="20" cy="20" r="${r}" fill="none" stroke="${t.p.primary}" stroke-width="${sw}" stroke-linecap="${ios ? "round" : "butt"}" stroke-dasharray="${+(c * pct / 100).toFixed(2)} ${c}" transform="rotate(-90 20 20)"/></svg>`;
        }
        const h = ios ? 6 : 4;
        return `<div ${a} aria-valuenow="${pct}" style="height:${h}px;border-radius:${ios ? 999 : 2}px;background:${t.p.surface};overflow:hidden"><div style="width:${pct}%;height:100%;background:${t.p.primary}"></div></div>`;
      }
      case "toggle": {
        const on = pr.checked === true;
        const w = ios ? 51 : 52, h = ios ? 31 : 32, d = ios ? 27 : on ? 24 : 16, pad = ios ? 2 : on ? 4 : 8;
        const track = on ? (ios ? t.p.success : t.p.primary) : ios ? (t.dark ? "#ffffff33" : "#78788033") : "transparent";
        const border = ios || on ? "0" : `2px solid ${t.p.muted}`;
        const thumb = ios || on ? "#FFFFFF" : t.p.muted;
        return `<label style="display:flex;align-items:center;justify-content:space-between;min-height:44px;font:400 ${Math.round(16 * t.scale)}px ${t.font};color:${t.p.text}">${esc(pr.label)}<button type="button" role="switch" aria-checked="${on}" aria-label="${esc(pr.label)}" style="position:relative;box-sizing:border-box;width:${w}px;height:${h}px;border-radius:999px;border:${border};background:${track};padding:0"><span style="position:absolute;top:50%;left:${on ? w - d - pad : pad}px;transform:translateY(-50%);width:${d}px;height:${d}px;border-radius:50%;background:${thumb}"></span></button></label>`;
      }
      case "segmented": {
        const wrap = ios
          ? `display:flex;padding:2px;border-radius:${Math.round(t.radius * 0.8)}px;background:${t.dark ? "#ffffff1f" : "#7676801f"}`
          : `display:flex;border:1px solid ${t.p.muted};border-radius:999px;overflow:hidden`;
        return `<div ${a} style="display:flex;flex-direction:column;gap:4px"><span style="font:500 ${Math.round(14 * t.scale)}px ${t.font};color:${t.p.text}">${esc(pr.label)}</span><div role="presentation" style="${wrap}">${inner}</div></div>`;
      }
      case "segment": {
        const on = pr.checked === true;
        const own = ios
          ? `border-radius:${Math.round(t.radius * 0.7)}px;background:${on ? (t.dark ? "#636366" : "#FFFFFF") : "transparent"};box-shadow:${on ? "0 1px 3px rgba(0,0,0,.2)" : "none"};font-weight:${on ? 600 : 400}`
          : `border-left:1px solid ${t.p.muted};background:${on ? t.p.primary : "transparent"};color:${on ? t.p.background : t.p.text}`;
        return `<button type="button" role="radio" aria-checked="${on}" style="flex:1;min-height:${ios ? 32 : 44}px;border:0;color:${t.p.text};font:500 ${Math.round(14 * t.scale)}px ${t.font};${own}">${esc(n.name)}</button>`;
      }
      case "sheet": {
        const handle = `<div style="width:${ios ? 36 : 32}px;height:${ios ? 5 : 4}px;border-radius:999px;background:${t.p.muted};opacity:.5;margin:8px auto 12px"></div>`;
        return `<div style="position:fixed;inset:0;background:rgba(0,0,0,.4)"></div><div ${a} aria-modal="true" style="position:fixed;left:0;right:0;bottom:0;max-height:80vh;overflow:auto;box-sizing:border-box;padding:0 16px 24px;background:${t.p.background};border-radius:${ios ? 12 : 28}px ${ios ? 12 : 28}px 0 0;box-shadow:${t.shadow}">${handle}<h2 style="margin:0 0 12px;font:700 ${Math.round(20 * t.scale)}px ${t.display};color:${t.p.text}">${esc(n.name)}</h2><div style="display:flex;flex-direction:column;gap:${gap("md")}px">${inner}</div></div>`;
      }
      case "chart":
        return `<figure style="margin:0;padding:12px;background:${t.p.surface};border-radius:${t.radius}px">${chartSvg(pr.kind as ChartKind, pr.points as ChartPoint[], t.p, n.name, esc, t.font)}</figure>`;
      case "kanban":
        return `<div ${a} style="display:flex;gap:${gap("md")}px;overflow-x:auto">${inner}</div>`;
      case "column":
        return `<div ${a} style="flex:0 0 ${ios ? 220 : 240}px;box-sizing:border-box;padding:12px;background:${t.p.surface};border-radius:${t.radius}px;display:flex;flex-direction:column;gap:8px"><div style="font:600 ${Math.round(14 * t.scale)}px ${t.font};color:${t.p.muted}">${esc(pr.title)}</div>${inner}</div>`;
      case "kcard":
        return `<div ${a} style="padding:12px;background:${t.p.background};border-radius:${Math.round(t.radius * 0.8)}px;box-shadow:${t.shadow};font:500 ${Math.round(15 * t.scale)}px ${t.font};color:${t.p.text}">${esc(pr.title)}${pr.detail ? `<div style="font:400 ${Math.round(13 * t.scale)}px ${t.font};color:${t.p.muted}">${esc(pr.detail)}</div>` : ""}</div>`;
      case "timeline":
        return `<div ${a} style="display:flex;flex-direction:column;gap:${gap("md")}px">${inner}</div>`;
      case "day":
        return `<div ${a} style="display:flex;flex-direction:column;gap:4px"><div style="font:600 ${Math.round(13 * t.scale)}px ${t.font};color:${t.p.muted}">${esc(n.name)}</div>${inner}</div>`;
      case "entry":
        return `<div ${a} style="padding:8px 0 8px 12px;border-left:2px solid ${t.p.primary};font:500 ${Math.round(15 * t.scale)}px ${t.font};color:${t.p.text}">${pr.time ? `<span style="color:${t.p.muted};margin-right:8px">${esc(pr.time)}</span>` : ""}${esc(pr.title)}${pr.detail ? `<div style="font:400 ${Math.round(13 * t.scale)}px ${t.font};color:${t.p.muted}">${esc(pr.detail)}</div>` : ""}</div>`;
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
      case "vector":
        return vectorSvg(Number(pr.width), Number(pr.height), pr.shapes as Shape[], n.name);
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
  const bar = ios
    ? `<header style="padding:54px 16px 10px;text-align:center;font:600 17px ${t.font};color:${t.p.text}">${esc(root.name)}</header>`
    : `<header style="padding:40px 16px 14px;font:500 22px ${t.font};color:${t.p.text};background:${t.p.surface};box-shadow:${t.shadow}">${esc(root.name)}</header>`;
  return `<!doctype html><html lang="${esc(language)}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(appName || root.name)}</title><style>@keyframes sv-fade{from{opacity:0}}@keyframes sv-slide{from{transform:translateY(16px);opacity:0}}@keyframes sv-scale{from{transform:scale(.9);opacity:0}}@keyframes sv-pulse{50%{transform:scale(1.06)}}[tabindex]:focus-visible{outline:2px solid ${t.p.primary};outline-offset:2px}</style></head>
}
