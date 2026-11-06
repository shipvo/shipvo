/**
 * The pure core of the Shipvo Runner: runs a spec's http data sources and actions.
 * No `eval`, no dynamic import, no user code. Network, secrets, cache and the clock are injected.
 */
import { extractExpressions } from "./cel.js";
import { estimateCost, evaluateTemplate, ExpressionError, MAX_COST } from "./eval.js";
import type { EvalOptions } from "./eval.js";

export type RunErrorCode =
  | "bad_spec" | "domain_not_allowed" | "secret_missing" | "request_failed"
  | "upstream_error" | "response_too_large" | "cost_limit" | "expression_error" | "unsupported_step";

/** Thrown by {@link runSource} and {@link runAction}. The message never contains a secret value. */
export class RunError extends Error {
  readonly code: RunErrorCode;
  constructor(code: RunErrorCode, message: string) {
    super(message);
    this.name = "RunError";
    this.code = code;
  }
}

export interface RunCache {
  get(key: string): unknown | undefined | Promise<unknown | undefined>;
  set(key: string, value: unknown, ttlMs: number): void | Promise<void>;
}

/** A simple in-memory cache with expiry. */
export function memoryCache(now: () => number = Date.now): RunCache {
  const m = new Map<string, { v: unknown; until: number }>();
  return {
    get(key) {
      const e = m.get(key);
      if (!e) return undefined;
      if (e.until <= now()) { m.delete(key); return undefined; }
      return e.v;
    },
    set(key, v, ttl) { m.set(key, { v, until: now() + ttl }); }
  };
}

export interface RunContext {
  fetch: (url: string, init: { method: string; headers: Record<string, string>; redirect: "manual" }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
  /** Returns the value of a vault key by name. The only place secrets come from. */
  secrets: (name: string) => string | undefined | Promise<string | undefined>;
  cache?: RunCache;
  /** Keeps one person's or app's cache entries apart from another's. Default "". */
  cacheScope?: string;
  /** Names for expressions: state, input, person and the data already loaded. */
  scope?: Record<string, unknown>;
  eval?: EvalOptions;
  /** Cost limit for each expression. Default {@link MAX_COST}. */
  maxCost?: number;
  /** Largest response body in characters. Default 5,000,000. */
  maxResponseChars?: number;
  /** Receives plain events (host, status, source name). Never secrets, URLs with query or bodies. */
  log?: (event: { event: string; source?: string; host?: string; status?: number; cached?: boolean }) => void;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const DEFAULT_MAX_CHARS = 5_000_000;
const UNITS: Record<string, number> = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 };

/** The field names the spec uses: names and quoted text in expressions, and bare names in blocks (chart x, y). */
export function usedFields(spec: unknown): Set<string> {
  const used = new Set<string>();
  const addExpr = (e: string) => {
    for (const m of e.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) used.add(m[0]);
  };
  const walk = (v: unknown, key: string | undefined): void => {
    if (typeof v === "string") {
      const t = extractExpressions(v);
      t.expressions.forEach(addExpr);
      if (key !== "data" && /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(v)) v.split(".").forEach((p) => used.add(p));
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  if (isObj(spec)) {
    for (const k of ["screens", "actions", "schedules", "data", "state"]) walk(spec[k], k);
  }
  return used;
}

/** Keeps only the used fields, at any depth. Lists are trimmed item by item. */
export function trimResponse(value: unknown, used: ReadonlySet<string>, depth = 0): unknown {
  if (depth > 100) return null;
  if (Array.isArray(value)) return value.map((x) => trimResponse(x, used, depth + 1));
  if (isObj(value)) {
    const out: Json = {};
    for (const [k, v] of Object.entries(value)) if (used.has(k)) out[k] = trimResponse(v, used, depth + 1);
    return out;
  }
  return value;
}

function evalGuard<T>(expr: string, fn: () => T, ctx: RunContext): T {
  const limit = ctx.maxCost ?? MAX_COST;
  try {
    return fn();
  } catch (e) {
    if (e instanceof ExpressionError) {
      const cost = estimateCost(expr);
      if (/costs \d+; the limit/.test(e.message) || (cost !== undefined && cost > limit)) {
        throw new RunError("cost_limit", e.message);
      }
      throw new RunError("expression_error", e.message);
    }
    throw e;
  }
}

function template(t: unknown, ctx: RunContext, extra: Record<string, unknown> = {}): unknown {
  if (typeof t === "string") {
    return evalGuard(t, () => evaluateTemplate(t, { ...ctx.scope, ...extra }, { ...ctx.eval, maxCost: ctx.maxCost ?? ctx.eval?.maxCost }), ctx);
  }
  if (Array.isArray(t)) return t.map((x) => template(x, ctx, extra));
  if (isObj(t)) return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, template(v, ctx, extra)]));
  return t;
}

function selectPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  let cur = value;
  for (const p of path.split(".")) {
    if (Array.isArray(cur) && /^\d+$/.test(p)) cur = cur[Number(p)];
    else if (isObj(cur)) cur = cur[p];
    else return null;
  }
  return cur === undefined ? null : cur;
}

/**
 * Runs one http data source: checks the domain, adds the vault key, calls `fetch`,
 * picks `select`, trims to the fields the spec uses and caches per `cache`.
 */
export async function runSource(spec: unknown, name: string, ctx: RunContext): Promise<unknown> {
  const s = isObj(spec) && isObj(spec.data) ? spec.data[name] : undefined;
  if (!isObj(s) || s.source !== "http") throw new RunError("bad_spec", `"${name}" is not an http data source in this spec.`);
  if (s.post !== undefined) throw new RunError("unsupported_step", `Data source "${name}" uses post, which does not run here yet. Use get.`);
  const raw = s.get;
  if (typeof raw !== "string") throw new RunError("bad_spec", `Data source "${name}" needs a "get" URL.`);
  const method = "GET";

  let url: URL;
  try {
    const target = template(raw, ctx);
    url = new URL(String(target));
  } catch (e) {
    if (e instanceof RunError) throw e;
    throw new RunError("bad_spec", `Data source "${name}" has a URL that is not valid.`);
  }
  const network = isObj(spec) && isObj(spec.permissions) && Array.isArray(spec.permissions.network) ? spec.permissions.network : [];
  if (url.protocol !== "https:" || !network.includes(url.hostname)) {
    throw new RunError("domain_not_allowed", `Data source "${name}" reaches ${url.hostname}, which is not in permissions.network (https only).`);
  }
  if (url.username || url.password) throw new RunError("bad_spec", `Data source "${name}" must not put credentials in the URL.`);

  const query = isObj(s.query) ? (template(s.query, ctx) as Json) : {};
  for (const [k, v] of Object.entries(query)) if (v !== null && v !== undefined) url.searchParams.set(k, String(v));

  const auth = isObj(s.auth) ? s.auth : undefined;
  const ttl = typeof s.cache === "string" ? parseTtl(s.cache) : 0;
  // The key holds the secret's name, never its value.
  // An authed source is cached only when the host sets cacheScope. Without it, two people
  // who saved a secret under the same name would share one entry.
  const useCache = ttl > 0 && !!ctx.cache && (!auth || !!ctx.cacheScope);
  const key = JSON.stringify([ctx.cacheScope ?? "", name, method, url.toString(), auth?.secret ?? null]);
  if (useCache) {
    const hit = await ctx.cache!.get(key);
    if (hit !== undefined) {
      ctx.log?.({ event: "source.cache_hit", source: name, host: url.hostname, cached: true });
      return hit;
    }
  }

  const headers: Record<string, string> = { accept: "application/json" };
  if (auth) {
    const secretName = String(auth.secret);
    const value = await ctx.secrets(secretName);
    if (!value) throw new RunError("secret_missing", `The key ${secretName} is not saved in the vault.`);
    const type = auth.type ?? "bearer";
    if (type === "bearer") headers.authorization = `Bearer ${value}`;
    else if (type === "basic") {
      let bin = "";
      for (const b of new TextEncoder().encode(value)) bin += String.fromCharCode(b);
      headers.authorization = `Basic ${btoa(bin)}`;
    }
    else if (type === "header") headers[String(auth.name ?? "x-api-key").toLowerCase()] = value;
    else if (type === "query") url.searchParams.set(String(auth.name ?? "key"), value);
    else throw new RunError("bad_spec", `Data source "${name}" has an auth type that is not known.`);
  }

  let res;
  try {
    res = await ctx.fetch(url.toString(), { method, headers, redirect: "manual" });
  } catch {
    // The thrown error may echo the URL, which can hold a key. Say only the host.
    throw new RunError("request_failed", `The request to ${url.hostname} failed.`);
  }
  ctx.log?.({ event: "source.fetch", source: name, host: url.hostname, status: res.status });
  if (res.status >= 300 && res.status < 400) throw new RunError("upstream_error", `${url.hostname} answered with a redirect, which is not followed.`);
  if (!res.ok) throw new RunError("upstream_error", `${url.hostname} answered with status ${res.status}.`);
  const text = await res.text();
  if (text.length > (ctx.maxResponseChars ?? DEFAULT_MAX_CHARS)) {
    throw new RunError("response_too_large", `The answer from ${url.hostname} is too large.`);
  }
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new RunError("upstream_error", `${url.hostname} did not answer with JSON.`); }

  const result = trimResponse(selectPath(body, typeof s.select === "string" ? s.select : undefined), usedFields(spec));
  if (useCache) await ctx.cache!.set(key, result, ttl);
  return result;
}

function parseTtl(c: string): number {
  const m = /^(\d+)([smhd])$/.exec(c);
  return m ? Number(m[1]) * UNITS[m[2]!]! : 0;
}

/**
 * Runs one action's server-side steps: `refresh` (reloads a data source), `if` and `return`.
 * Steps that change the phone (toast, navigate, set, collections) are skipped here.
 * `http` writes need an approval and are refused by this core.
 */
export async function runAction(spec: unknown, name: string, input: Record<string, unknown>, ctx: RunContext): Promise<unknown> {
  const a = isObj(spec) && isObj(spec.actions) ? spec.actions[name] : undefined;
  if (!isObj(a) || !Array.isArray(a.do)) throw new RunError("bad_spec", `"${name}" is not an action in this spec.`);
  const scope = { ...ctx.scope, input };
  const local: RunContext = { ...ctx, scope };
  const out = await steps(spec, a.do, local);
  return out.done ? out.value : null;
}

async function steps(spec: unknown, list: unknown[], ctx: RunContext): Promise<{ done: boolean; value?: unknown }> {
  for (const st of list) {
    if (!isObj(st)) throw new RunError("bad_spec", "An action step must be an object.");
    if (typeof st.refresh === "string") {
      const value = await runSource(spec, st.refresh, ctx);
      const data = isObj(ctx.scope?.data) ? ctx.scope.data : {};
      ctx.scope = { ...ctx.scope, [st.refresh]: value, data: { ...data, [st.refresh]: value } };
    } else if ("http" in st) {
      throw new RunError("unsupported_step", "http steps need the person's approval and do not run here.");
    } else if (typeof st.if === "string") {
      const cond = template(`{{ ${st.if.replace(/^\{\{\s*|\s*\}\}$/g, "")} }}`, ctx);
      const branch = cond === true ? st.then : st.else;
      if (Array.isArray(branch)) {
        const r = await steps(spec, branch, ctx);
        if (r.done) return r;
      }
    } else if ("return" in st) {
      return { done: true, value: template(st.return, ctx) };
    }
  }
  return { done: false };
}
