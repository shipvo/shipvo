/**
 * Evaluates CEL expressions (https://cel.dev) with the Shipvo function library.
 * Numbers are doubles, like JSON: `1` and `1.0` are the same, so `a / b - 1` works.
 */
import { celEnv, celFunc, celList, celMap, CelScalar, isCelError, isCelList, isCelMap, parse, plan } from "@bufbuild/cel";
import type { CelFunc, CelInput, CelValue } from "@bufbuild/cel";
import { extractExpressions } from "./cel.js";

export const MAX_EXPRESSION_CHARS = 2000;
/** Default cost limit. Cost is a static estimate: nodes, times 100 for each list loop (a macro) they sit in. */
export const MAX_COST = 100_000;
const ASSUMED_LIST_SIZE = 100;

export interface EvalOptions {
  /** Locale for money, number, percent and compact. Default "en-US". */
  locale?: string;
  /** IANA time zone for startOf, endOf, today and formatDate. Default "UTC". */
  timeZone?: string;
  /** The value of `now` and `today()`. Default: the current time. */
  now?: Date | string | number;
  /** Cost limit. Default {@link MAX_COST}. */
  maxCost?: number;
}

/** Thrown when an expression is too long, too costly, wrong, or fails to run. */
export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

// ---- Function library -----------------------------------------------------

const D = CelScalar.DYN;
export const LIBRARY_ARITY: Record<string, [number, number]> = {
  sum: [1, 1], avg: [1, 1], min: [1, 1], max: [1, 1], count: [1, 1], unique: [1, 2], sortBy: [2, 3], groupBy: [2, 2],
  first: [1, 1], last: [1, 1], take: [2, 2],
  today: [0, 0], startOf: [2, 2], endOf: [2, 2], addDays: [2, 2], diffDays: [2, 2], formatDate: [2, 2], unix: [1, 1],
  money: [2, 2], number: [1, 2], percent: [1, 1], compact: [1, 1],
  lower: [1, 1], upper: [1, 1], trim: [1, 1], split: [2, 2], join: [2, 2], orElse: [2, 2], csv: [1, 2], parseCsv: [1, 1]
};

const toJs = (v: unknown): unknown => {
  if (typeof v === "bigint") return Number(v);
  if (isCelList(v)) return Array.from(v, toJs);
  if (isCelMap(v)) return Object.fromEntries(Array.from(v, ([k, x]) => [String(k), toJs(x)]));
  return v;
};
const toList = (v: unknown, fn: string): unknown[] => {
  const j = toJs(v);
  if (!Array.isArray(j)) throw new Error(`${fn}() needs a list`);
  return j;
};
const nums = (v: unknown, fn: string): number[] =>
  toList(v, fn).map((x) => {
    if (typeof x !== "number") throw new Error(`${fn}() needs a list of numbers`);
    return x;
  });
const field = (o: unknown, f: unknown): unknown => (o !== null && typeof o === "object" ? (o as Record<string, unknown>)[String(f)] : undefined);
const cmp = (a: unknown, b: unknown) => (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
const toDate = (v: unknown): Date => {
  const d = typeof v === "number" ? new Date(v * 1000) : new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new Error(`"${String(v)}" is not a date`);
  return d;
};
const out = (v: unknown): CelInput => (v === undefined ? null : (v as CelInput));

function zoneOffset(d: Date, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric"
  }).formatToParts(d).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(d.getTime() / 1000) * 1000;
}

const UNITS = ["day", "week", "month", "year"];
function bound(unit: string, ts: Date, tz: string, end: boolean): Date {
  if (!UNITS.includes(unit)) throw new Error(`unit must be one of ${UNITS.join(", ")}`);
  const local = new Date(ts.getTime() + zoneOffset(ts, tz)); // wall-clock time, read with getUTC*
  let y = local.getUTCFullYear(), m = local.getUTCMonth(), day = local.getUTCDate();
  if (unit === "week") day -= (local.getUTCDay() + 6) % 7; // weeks start on Monday
  if (unit === "month") day = 1;
  if (unit === "year") { m = 0; day = 1; }
  let start = Date.UTC(y, m, day);
  if (end) {
    const s = new Date(start);
    start = unit === "day" ? start + 864e5 : unit === "week" ? start + 7 * 864e5
      : unit === "month" ? Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 1) : Date.UTC(s.getUTCFullYear() + 1, 0, 1);
    start -= 1;
  }
  return new Date(start - zoneOffset(new Date(start), tz));
}

function formatDate(d: Date, pattern: string, locale: string, tz: string): string {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: tz, ...o }).format(d);
  switch (pattern) {
    case "day": return f({ dateStyle: "medium" });
    case "month": return f({ month: "long", year: "numeric" });
    case "year": return f({ year: "numeric" });
    case "time": return f({ timeStyle: "short" });
    case "datetime": return f({ dateStyle: "medium", timeStyle: "short" });
    case "iso": return d.toISOString();
    default: throw new Error(`pattern must be one of day, month, year, time, datetime, iso`);
  }
}

function library(o: Required<Pick<EvalOptions, "locale" | "timeZone">> & { now: Date }): CelFunc[] {
  const f = (name: string, n: number, impl: (...a: unknown[]) => unknown): CelFunc =>
    celFunc(name, Array(n).fill(D) as [], D, ((...a: unknown[]) => {
      try { return out(impl(...a.map(toJs))); } catch (e) { throw e instanceof Error ? e : new Error(String(e)); }
    }) as never);
  const fmt = (opts: Intl.NumberFormatOptions) => new Intl.NumberFormat(o.locale, opts);
  const list = (v: unknown, fn: string) => { if (!Array.isArray(v)) throw new Error(`${fn}() needs a list`); return v; };
  const sortBy = (l: unknown, k: unknown, dir: unknown = "asc") => {
    if (dir !== "asc" && dir !== "desc") throw new Error("direction must be 'asc' or 'desc'");
    return [...list(l, "sortBy")].sort((a, b) => cmp(field(a, k), field(b, k)) * (dir === "desc" ? -1 : 1));
  };
  const unique = (l: unknown, k?: unknown) => {
    const seen = new Set<unknown>();
    return list(l, "unique").map((x) => (k === undefined ? x : field(x, k))).filter((x) => !seen.has(x) && seen.add(x));
  };
  const cell = (v: unknown): string => {
    const t = v === null || v === undefined ? "" : Array.isArray(v) ? v.map((x) => (x === null || x === undefined ? "" : typeof x === "object" ? JSON.stringify(x) : String(x))).join("; ") : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const csv = (l: unknown, cols?: unknown) => {
    const rows = list(l, "csv");
    let keys: string[];
    if (cols === undefined) {
      keys = [];
      for (const r of rows) if (r && typeof r === "object") for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
    } else keys = list(cols, "csv").map(String);
    const line = (cells: string[]) => cells.join(",");
    return [line(keys.map(cell)), ...rows.map((r) => line(keys.map((k) => cell(r !== null && typeof r === "object" ? (r as Record<string, unknown>)[k] : undefined))))].join("\r\n") + "\r\n";
  };
  const parseCsv = (t: unknown) => {
    if (typeof t !== "string") throw new Error("parseCsv() needs text");
    const text = t.replace(/^\uFEFF/, "");
    const table: string[][] = [];
    let row: string[] = [], cur = "", quoted = false, any = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false; } else cur += c;
      } else if (c === '"' && cur === "") { quoted = true; any = true; }
      else if (c === ",") { row.push(cur); cur = ""; any = true; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (any || cur !== "") { row.push(cur); table.push(row); }
        row = []; cur = ""; any = false;
      } else { cur += c; any = true; }
    }
    if (quoted) throw new Error("parseCsv() found a quote that is never closed");
    if (any || cur !== "") { row.push(cur); table.push(row); }
    const [head, ...body] = table;
    if (!head) return [];
    return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
  };
  const empty = (l: unknown[], fn: string) => { if (!l.length) throw new Error(`${fn}() needs a non-empty list`); return l; };
  return [
    f("sum", 1, (l) => nums(l, "sum").reduce((a: number, b: number) => a + b, 0)),
    f("avg", 1, (l) => { const n = nums(l, "avg"); return empty(n, "avg").reduce((a: number, b) => a + (b as number), 0) / n.length; }),
    f("min", 1, (l) => Math.min(...(empty(nums(l, "min"), "min") as number[]))),
    f("max", 1, (l) => Math.max(...(empty(nums(l, "max"), "max") as number[]))),
    f("count", 1, (x) => (typeof x === "string" || Array.isArray(x) ? x.length : x && typeof x === "object" ? Object.keys(x).length : (() => { throw new Error("count() needs a list, map or text"); })())),
    f("unique", 1, unique), f("unique", 2, unique),
    f("sortBy", 2, sortBy), f("sortBy", 3, sortBy),
    f("groupBy", 2, (l, k) => {
      const g: Record<string, unknown[]> = {};
      for (const x of list(l, "groupBy")) (g[String(field(x, k))] ??= []).push(x);
      return g;
    }),
    f("first", 1, (l) => list(l, "first")[0]),
    f("last", 1, (l) => list(l, "last").at(-1)),
    f("take", 2, (l, n) => list(l, "take").slice(0, Math.max(0, Number(n)))),
    f("today", 0, () => bound("day", o.now, o.timeZone, false).toISOString()),
    f("startOf", 2, (u, t) => bound(String(u), toDate(t), o.timeZone, false).toISOString()),
    f("endOf", 2, (u, t) => bound(String(u), toDate(t), o.timeZone, true).toISOString()),
    f("addDays", 2, (t, n) => new Date(toDate(t).getTime() + Number(n) * 864e5).toISOString()),
    f("diffDays", 2, (a, b) => (toDate(a).getTime() - toDate(b).getTime()) / 864e5),
    f("formatDate", 2, (t, p) => formatDate(toDate(t), String(p), o.locale, o.timeZone)),
    f("unix", 1, (t) => Math.floor(toDate(t).getTime() / 1000)),
    f("money", 2, (a, c) => fmt({ style: "currency", currency: String(c) }).format(Number(a))),
    f("number", 1, (x) => fmt({}).format(Number(x))),
    f("number", 2, (x, d) => fmt({ minimumFractionDigits: Number(d), maximumFractionDigits: Number(d) }).format(Number(x))),
    f("percent", 1, (x) => fmt({ style: "percent", maximumFractionDigits: 1 }).format(Number(x))),
    f("compact", 1, (x) => fmt({ notation: "compact", maximumFractionDigits: 1 }).format(Number(x))),
    f("lower", 1, (s) => String(s).toLowerCase()), f("upper", 1, (s) => String(s).toUpperCase()), f("trim", 1, (s) => String(s).trim()),
    f("split", 2, (s, sep) => String(s).split(String(sep))),
    f("join", 2, (l, sep) => list(l, "join").join(String(sep))),
    f("__mod", 2, (a, b) => {
      if (b === 0) throw new Error("modulo by zero");
      return (a as number) % (b as number);
    }),
    f("orElse", 2, (v, fb) => (v === null || v === undefined ? fb : v)),
    f("csv", 1, (l) => csv(l)),
    f("csv", 2, (l, c) => csv(l, c)),
    f("parseCsv", 1, parseCsv)
  ];
}

// ---- Cost, rewriting and running ------------------------------------------

type AnyExpr = { exprKind: { case?: string; value?: any } };

/** Walks the tree: estimates the cost, and rewrites int literals to doubles and `size` to `count`. */
function walk(e: AnyExpr | undefined, mult: number, st: { cost: number }): void {
  if (!e) return;
  st.cost += mult;
  const k = e.exprKind;
  switch (k.case) {
    case "constExpr": {
      const c = k.value.constantKind;
      if (c.case === "int64Value") k.value.constantKind = { case: "doubleValue", value: Number(c.value) };
      break;
    }
    case "selectExpr": walk(k.value.operand, mult, st); break;
    case "listExpr": k.value.elements.forEach((x: AnyExpr) => walk(x, mult, st)); break;
    case "structExpr": k.value.entries.forEach((x: any) => { walk(x.keyKind?.value, mult, st); walk(x.value, mult, st); }); break;
    case "callExpr": {
      const c = k.value;
      if (c.function === "_%_") c.function = "__mod";
      if (c.function === "size") {
        c.function = "count";
        if (c.target) { c.args = [c.target]; c.target = undefined; }
      }
      walk(c.target, mult, st);
      c.args.forEach((x: AnyExpr) => walk(x, mult, st));
      break;
    }
    case "comprehensionExpr": {
      const c = k.value;
      walk(c.iterRange, mult, st);
      walk(c.accuInit, mult, st);
      const m = mult * ASSUMED_LIST_SIZE;
      walk(c.loopCondition, m, st);
      walk(c.loopStep, m, st);
      walk(c.result, mult, st);
      break;
    }
  }
}

/** The estimated cost of an expression, or undefined if it does not parse. */
export function estimateCost(expression: string): number | undefined {
  try {
    const st = { cost: 0 };
    walk(parse(expression).expr as unknown as AnyExpr, 1, st);
    return st.cost;
  } catch {
    return undefined;
  }
}

function toBinding(v: unknown, depth = 0): CelInput {
  if (depth > 100) throw new ExpressionError("The data is nested too deeply.");
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "bigint") return Number(v);
  if (Array.isArray(v)) return celList(v.map((x) => toBinding(x, depth + 1)));
  if (typeof v === "object") return celMap(new Map(Object.entries(v).map(([k, x]) => [k, toBinding(x, depth + 1)])));
  throw new ExpressionError(`A ${typeof v} value cannot be used in an expression.`);
}

/** A regex test with a guard: long patterns, backreferences and nested repeats and alternation under a repeat are refused. */
const re2 = {
  compile(p: string) {
    if (p.length > 200 || /\\[1-9]/.test(p) || /[*+}]\)?[*+{]/.test(p) || /\([^)]*[*+][^)]*\)[*+{]/.test(p) || /\([^)]*\|[^)]*\)[*+{]/.test(p)) throw new Error("this pattern is not allowed");
    const re = new RegExp(p, "u");
    return { test: (t: string) => re.test(t) };
  }
};

/**
 * Runs one CEL expression and returns a plain JS value (numbers, strings, booleans, arrays, objects, null).
 * Throws {@link ExpressionError} when the expression is over 2,000 characters, over the cost limit, wrong, or fails.
 */
export function evaluate(expression: string, scope: Record<string, unknown> = {}, options: EvalOptions = {}): unknown {
  if (expression.length > MAX_EXPRESSION_CHARS) {
    throw new ExpressionError(`Expression is ${expression.length} characters; the limit is ${MAX_EXPRESSION_CHARS}.`);
  }
  const now = options.now === undefined ? new Date() : new Date(options.now);
  if (Number.isNaN(now.getTime())) throw new ExpressionError("options.now is not a valid date.");
  const opts = { locale: options.locale ?? "en-US", timeZone: options.timeZone ?? "UTC", now };
  try {
    zoneOffset(now, opts.timeZone);
    fmtCheck(opts.locale);
  } catch {
    throw new ExpressionError("options.locale or options.timeZone is not valid.");
  }
  let parsed;
  try {
    parsed = parse(expression);
  } catch (e) {
    throw new ExpressionError(`Expression is not valid CEL: ${e instanceof Error ? e.message : "unreadable"}.`);
  }
  const st = { cost: 0 };
  walk(parsed.expr as unknown as AnyExpr, 1, st);
  const limit = options.maxCost ?? MAX_COST;
  if (st.cost > limit) throw new ExpressionError(`Expression costs ${st.cost}; the limit is ${limit}.`);
  const bindings: Record<string, CelInput> = {};
  for (const [k, v] of Object.entries({ ...scope, now: now.toISOString() })) bindings[k] = toBinding(v);
  try {
    const env = celEnv({ funcs: library(opts), re2, variables: Object.fromEntries(Object.keys(bindings).map((k) => [k, D])) });
    const r = plan(env, parsed)(bindings);
    if (isCelError(r)) throw new ExpressionError(r.message);
    const v = toJs(r as CelValue);
    assertFinite(v);
    return v;
  } catch (e) {
    if (e instanceof ExpressionError) throw e;
    throw new ExpressionError(e instanceof Error ? e.message : "The expression failed.");
  }
}
function assertFinite(v: unknown): void {
  if (typeof v === "number" && !Number.isFinite(v)) throw new ExpressionError("The result is not a finite number (division by zero?).");
  if (Array.isArray(v)) v.forEach(assertFinite);
  else if (v && typeof v === "object") Object.values(v).forEach(assertFinite);
}
const fmtCheck = (locale: string) => new Intl.NumberFormat(locale);

/**
 * Fills the `{{ }}` parts of a string. A string that is only one `{{ }}` returns the value with its type;
 * otherwise each part is turned into text and the result is a string.
 */
export function evaluateTemplate(template: string, scope: Record<string, unknown> = {}, options: EvalOptions = {}): unknown {
  const t = extractExpressions(template);
  if (t.unterminated) throw new ExpressionError('A "{{" has no closing "}}".');
  if (t.expressions.length === 0) return template;
  if (t.expressions.length === 1 && template.trim() === `{{${t.expressions[0]}}}`) return evaluate(t.expressions[0]!, scope, options);
  let result = "";
  let rest = template;
  for (const e of t.expressions) {
    const start = rest.indexOf("{{");
    const end = start + 2 + e.length + 2;
    const v = evaluate(e, scope, options);
    result += rest.slice(0, start) + (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
    rest = rest.slice(end);
  }
  return result + rest;
}
