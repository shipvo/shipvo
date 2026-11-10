import schema from "./app-spec.v0.schema.json" with { type: "json" };
import { checkNames, type NameScope } from "./check.js";
import { estimateCost, MAX_COST } from "./eval.js";
import { celSyntaxError, expressionSteps, extractExpressions, MAX_EXPRESSION_STEPS } from "./cel.js";
import { VECTOR_SHAPES, ENTER_MOTIONS, CHANGE_MOTIONS } from "./vector.js";
import { CALENDAR_VIEWS, isDay, validCoords } from "./calendar-map.js";
import { AGGREGATES, CHART_KINDS } from "./chart.js";
import { checkSchema } from "./jsonschema.js";
import { childPath, isObject, type Issue, type ValidationResult } from "./types.js";

export const MAX_SCREENS = 40;
export const MAX_BLOCKS = 2000;
export const MAX_EXPRESSION_LENGTH = 2000;
const MAX_WALK_DEPTH = 100;
const BLOCK_CONTAINERS = ["children"];

const INTERACTIVE = new Set([
  "button", "toggle", "segmented", "slider", "search", "date", "picker", "chips", "rating", "camera", "scanner", "file", "form", "custom"
]);

/** Well-known key shapes. Each one is a secret value, never a name. */
const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{8,}/,
  /\bwhsec_[A-Za-z0-9]{8,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/
];

function looksLikeSecret(s: string): boolean {
  if (SECRET_PATTERNS.some((re) => re.test(s))) return true;
  // One long unbroken token that mixes letters and digits, like a random key.
  if (/^[A-Za-z0-9_-]{32,}$/.test(s) && (s.match(/[0-9]/g)?.length ?? 0) >= 4) {
    return /[A-Z]/.test(s) || /^[0-9a-f]+$/.test(s);
  }
  return false;
}

function hexToRgb(hex: string): [number, number, number] | undefined {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return undefined;
  let h = m[1]!;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: string, b: string): number | undefined {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return undefined;
  const la = luminance(ra);
  const lb = luminance(rb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Why a URL cannot be checked, or its lower-case host. Parsed like a browser would. */
function parseHost(url: string): { host: string } | { problem: string } {
  const u = url.trim();
  if (u.includes("\\")) return { problem: "The URL must not contain backslashes." };
  if (!/^https:\/\//i.test(u)) return { problem: "The URL must be absolute and start with https://." };
  const authority = /^https:\/\/([^/?#]*)/i.exec(u)![1]!;
  if (authority.includes("{{")) return { problem: "The host of the URL must be fixed, not a {{ }} expression." };
  try {
    const host = new URL(u).hostname.toLowerCase();
    if (host === "") return { problem: "The URL has no host." };
    return { host };
  } catch {
    return { problem: "The URL cannot be read." };
  }
}

function allowed(host: string, list: unknown): boolean {
  if (!Array.isArray(list)) return false;
  return list.some((d) => {
    if (typeof d !== "string") return false;
    const dom = d.toLowerCase();
    return dom.startsWith("*.") ? host.endsWith(dom.slice(1)) : host === dom;
  });
}

const URL_FIX = "Write the full URL with a fixed host, for example https://api.example.com/v1/items/{{ id }}. Keep {{ }} to the path and query.";

class Run {
  errors: Issue[] = [];
  warnings: Issue[] = [];
  blocks = 0;
  constructor(readonly spec: Record<string, unknown>) {}

  error(path: string, message: string, fix: string) { this.errors.push({ path, message, fix }); }
  warn(path: string, message: string, fix: string) { this.warnings.push({ path, message, fix }); }

  /** Every string in the document: secret-looking values and `{{ }}` expressions. */
  scanStrings(v: unknown, path: string, depth = 0): void {
    if (depth > MAX_WALK_DEPTH) return;
    if (typeof v === "string") {
      if (looksLikeSecret(v)) {
        this.error(path, "This string looks like a secret value (a key or token).",
          "Remove it. Declare the key by name in \"secrets\" and refer to it with auth.secret; the value goes in the vault.");
      }
      if (v.includes("{{")) this.checkTemplate(v, path);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => this.scanStrings(x, childPath(path, i), depth + 1));
    } else if (isObject(v)) {
      for (const [k, x] of Object.entries(v)) this.scanStrings(x, childPath(path, k), depth + 1);
    }
  }

  /** Warns about keys in `strings` that no text in the spec uses. */
  checkStrings() {
    const table = this.spec.strings;
    if (!isObject(table)) return;
    const used = new Set<string>();
    const collect = (v: unknown, depth = 0) => {
      if (depth > MAX_WALK_DEPTH) return;
      if (typeof v === "string") used.add(v);
      else if (Array.isArray(v)) v.forEach((x) => collect(x, depth + 1));
      else if (isObject(v)) for (const [k, x] of Object.entries(v)) if (k !== "strings") collect(x, depth + 1);
    };
    for (const [k, x] of Object.entries(this.spec)) if (k !== "strings") collect(x);
    for (const [lang, keys] of Object.entries(table)) {
      if (!isObject(keys)) continue;
      for (const key of Object.keys(keys)) {
        if (!used.has(key)) {
          this.warn(childPath(childPath("$.strings", lang), key), `The key "${key}" in strings.${lang} matches no text in the spec.`,
            "Fix the key so it equals the text exactly, or remove it.");
        }
      }
    }
  }

  checkExpression(src: string, path: string) {
    if (src.length > MAX_EXPRESSION_LENGTH) {
      this.error(path, `Expression is ${src.length} characters; the limit is ${MAX_EXPRESSION_LENGTH}.`,
        "Split it into computed values in \"data\" and refer to them by name.");
      return;
    }
    const steps = expressionSteps(src);
    if (steps !== undefined && steps > MAX_EXPRESSION_STEPS) {
      this.error(path, `Expression has ${steps} steps; the limit is ${MAX_EXPRESSION_STEPS}.`,
        "Split it into computed values in \"data\" and refer to them by name.");
      return;
    }
    const err = celSyntaxError(src);
    if (err) {
      this.error(path, `Expression is not valid CEL: ${err}.`, "Fix the syntax. Expressions use CEL (https://cel.dev), for example money(total, 'EUR').");
      return;
    }
    const cost = estimateCost(src);
    if (cost !== undefined && cost > MAX_COST) {
      this.error(path, `Expression costs ${cost}; the limit is ${MAX_COST}.`, "Avoid nesting filter, map, exists and all inside each other. Compute the inner list as a value in \"data\".");
      return;
    }
    for (const p of checkNames(src, this.scopeAt(path))) this.error(path, p.message, p.fix);
  }

  /** The names an expression may use at this place in the spec. */
  scopeAt(path: string): NameScope {
    const keys = (v: unknown) => (isObject(v) ? Object.keys(v) : []);
    const dataNames = keys(this.spec.data);
    const stateNames = keys(this.spec.state);
    const names: NameScope["names"] = { data: dataNames, state: stateNames, route: ["params"] };
    for (const d of dataNames) names[d] = undefined;
    if (/^\$\.data\.[^.[]+\.paginate/.test(path) || /^\$\.data\["[^"]+"\]\.paginate/.test(path)) return { names, loose: true };
    if (path.startsWith("$.screens")) names.item = undefined;
    if (path.includes(".onMove.")) names.column = undefined;
    const action = /^\$\.actions(?:\.([A-Za-z_][A-Za-z0-9_]*)|\["([^"]+)"\])/.exec(path);
    if (action && isObject(this.spec.actions)) {
      const a = this.spec.actions[action[1] ?? action[2]!];
      names.input = isObject(a) && isObject(a.input) ? Object.keys(a.input) : undefined;
      names.result = undefined;
    } else if (path.startsWith("$.schedules")) {
      names.input = undefined;
      names.result = undefined;
    }
    return { names };
  }

  checkTemplate(s: string, path: string) {
    const t = extractExpressions(s);
    if (t.unterminated) this.error(path, "A \"{{\" has no closing \"}}\".", "Close the expression with \"}}\".");
    t.expressions.forEach((e) => this.checkExpression(e, path));
  }

  checkBare(v: unknown, path: string) {
    if (typeof v !== "string") return;
    if (v.includes("{{")) return; // already checked as a template
    this.checkExpression(v, path);
  }

  domains() {
    const p = isObject(this.spec.permissions) ? this.spec.permissions : {};
    return { network: p.network, write: p.write };
  }

  checkData() {
    const data = this.spec.data;
    if (!isObject(data)) return;
    for (const [name, src] of Object.entries(data)) {
      if (!isObject(src)) continue;
      const base = childPath("$.data", name);
      if (src.source === "http") {
        for (const key of ["get", "post"] as const) {
          const url = src[key];
          if (typeof url !== "string") continue;
          const parsed = parseHost(url);
          const p = childPath(base, key);
          if ("problem" in parsed) {
            this.error(p, parsed.problem, URL_FIX);
          } else if (!allowed(parsed.host, this.domains().network)) {
            this.error(p, `"${parsed.host}" is not declared in permissions.network.`, `Add "${parsed.host}" to permissions.network.`);
          }
        }
      }
      if (isObject(src.paginate)) {
        this.checkBare(src.paginate.next, childPath(childPath(base, "paginate"), "next"));
        this.checkBare(src.paginate.until, childPath(childPath(base, "paginate"), "until"));
      }
    }
  }

  checkSteps(steps: unknown, path: string, depth = 0) {
    if (!Array.isArray(steps) || depth > 20) return;
    steps.forEach((step, i) => {
      if (!isObject(step)) return;
      const p = childPath(path, i);
      if (isObject(step.http)) {
        const http = step.http;
        const key = (["url", "get", "post"] as const).find((k) => typeof http[k] === "string");
        const hp = childPath(childPath(p, "http"), key ?? "url");
        const parsed = key ? parseHost(http[key] as string) : { problem: "The step has no URL." };
        if ("problem" in parsed) {
          this.error(hp, parsed.problem, URL_FIX);
        } else if (!allowed(parsed.host, this.domains().write)) {
          this.error(hp, `"${parsed.host}" is not declared in permissions.write.`, `Add "${parsed.host}" to permissions.write.`);
        }
      }
      if (typeof step.if === "string") this.checkBare(step.if, childPath(p, "if"));
      this.checkSteps(step.then, childPath(p, "then"), depth + 1);
      this.checkSteps(step.else, childPath(p, "else"), depth + 1);
    });
  }

  checkActions() {
    const actions = this.spec.actions;
    if (isObject(actions)) {
      for (const [name, a] of Object.entries(actions)) {
        if (!isObject(a)) continue;
        const p = childPath("$.actions", name);
        this.checkSteps(a.do, childPath(p, "do"));
        if (typeof a.description !== "string" || a.description === "") {
          this.warn(p, "Action has no description.", "Add \"description\": agents read it to decide when to call this action.");
        }
      }
    }
    if (Array.isArray(this.spec.schedules)) {
      this.spec.schedules.forEach((s, i) => {
        if (isObject(s)) this.checkSteps(s.do, childPath(childPath("$.schedules", i), "do"));
      });
    }
  }

  checkTheme() {
    const theme = this.spec.theme;
    if (!isObject(theme) || !isObject(theme.palette)) return;
    const pal = theme.palette;
    for (const fg of ["text", "muted"]) {
      for (const bg of ["background", "surface"]) {
        const a = pal[fg];
        const b = pal[bg];
        if (typeof a !== "string" || typeof b !== "string") continue;
        const ratio = contrastRatio(a, b);
        if (ratio !== undefined && ratio < 4.5) {
          this.error(childPath("$.theme.palette", fg),
            `Contrast of ${fg} (${a}) on ${bg} (${b}) is ${ratio.toFixed(2)}:1; WCAG AA needs 4.5:1.`,
            `Pick a ${fg} colour that is lighter or darker so the ratio is at least 4.5:1.`);
        }
      }
    }
  }

  /** Walk one screen: count blocks and apply the block rules. */
  walkBlocks(v: unknown, path: string, screen: ScreenStats, depth = 0) {
    if (depth > MAX_WALK_DEPTH) return;
    if (Array.isArray(v)) {
      v.forEach((x, i) => this.walkBlocks(x, childPath(path, i), screen, depth + 1));
      return;
    }
    if (!isObject(v)) return;
    if (typeof v.type === "string") this.block(v, path, screen);
    // Blocks nest only through "children"; other objects with a "type" (columns, fields) are not blocks.
    for (const k of BLOCK_CONTAINERS) {
      if (Array.isArray(v[k])) this.walkBlocks(v[k], childPath(path, k), screen, depth + 1);
    }
  }

  block(b: Record<string, unknown>, path: string, screen: ScreenStats) {
    this.blocks++;
    const type = b.type as string;
    if (b.when !== undefined) this.checkBare(b.when, childPath(path, "when"));
    if (INTERACTIVE.has(type) && (typeof b.label !== "string" || b.label.trim() === "")) {
      this.error(path, `Interactive block "${type}" has no label.`, "Add \"label\": a short name that people and agents see, for example \"Add goal\".");
    }
    if (type === "toggle" || type === "segmented") this.checkBind(b, path);
    if (type === "segmented" && !(Array.isArray(b.options) && b.options.length > 0 && b.options.every((o) => typeof o === "string" && o !== ""))) {
      this.error(childPath(path, "options"), "Segmented control has no options.", "Add \"options\": a list of two or more short texts, for example [\"day\", \"week\", \"month\"].");
    }
    if (type === "list" && !isObject(b.empty)) {
      this.warn(path, "List has no empty state.", "Add \"empty\": { \"message\": \"...\" } so an empty list explains itself.");
    }
    if (type === "chart") this.chart(b, path);
    if (type === "kanban") this.kanban(b, path);
    if (type === "vector") this.vector(b, path);
    if (b.motion !== undefined) this.motion(b.motion, childPath(path, "motion"));
    if (type === "timeline") this.timeline(b, path);
    if (type === "calendar") this.calendar(b, path);
    if (type === "map") this.map(b, path);
    if (type === "text" && typeof b.variant === "string") screen.sizes.add(`variant:${b.variant}`);
    if (isObject(b.style)) {
      const st = b.style;
      if (typeof st.fontSize === "number") screen.sizes.add(`px:${st.fontSize}`);
      for (const k of ["gap", "padding", "margin"]) {
        const x = st[k];
        if (typeof x === "number") screen.spacing.add(x);
      }
      if (INTERACTIVE.has(type)) {
        for (const k of ["height", "minHeight", "width", "minWidth"]) {
          const x = st[k];
          if (typeof x === "number" && x < 44) {
            this.warn(childPath(childPath(path, "style"), k), `Touch target is ${x} px; the minimum is 44 px.`, `Use ${k}: 44 or more.`);
          }
        }
      }
    }
  }

  /** A toggle or segmented control writes to a declared state key: `"bind": "state.name"`. */
  checkBind(b: Record<string, unknown>, path: string) {
    const bp = childPath(path, "bind");
    const m = typeof b.bind === "string" ? /^state\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(b.bind) : null;
    if (!m) {
      this.error(bp, `"${String(b.type)}" needs a "bind" to a state value.`, "Add \"bind\": \"state.name\" and declare \"name\" in \"state\".");
    } else if (!isObject(this.spec.state) || !(m[1]! in this.spec.state)) {
      this.error(bp, `State "${m[1]}" is not declared.`, `Add "${m[1]}" to "state" with a type and a default.`);
    }
  }

  vector(b: Record<string, unknown>, path: string) {
    if (typeof b.label !== "string" || b.label.trim() === "") {
      this.error(childPath(path, "label"), "Vector has no label.", "Add \"label\": a short description agents can read, for example \"Battery gauge\".");
    }
    if (!Array.isArray(b.shapes)) {
      this.error(childPath(path, "shapes"), "Vector has no shapes.", "Add \"shapes\": a list such as [{ \"shape\": \"circle\", \"cx\": 50, \"cy\": 50, \"r\": 40 }].");
      return;
    }
    b.shapes.forEach((s, i) => {
      const sp = childPath(childPath(path, "shapes"), i);
      const kind = isObject(s) ? s.shape : undefined;
      if (typeof kind !== "string" || !(VECTOR_SHAPES as readonly string[]).includes(kind)) {
        this.error(childPath(sp, "shape"), `Shape ${JSON.stringify(kind ?? null)} is not supported.`, `Use one of: ${VECTOR_SHAPES.join(", ")}.`);
      }
    });
  }

  motion(m: unknown, path: string) {
    if (!isObject(m)) {
      this.error(path, "Motion must be an object.", "Use { \"enter\": \"fade\", \"change\": \"pulse\" }.");
      return;
    }
    if (m.enter !== undefined && !(ENTER_MOTIONS as readonly string[]).includes(m.enter as string)) {
      this.error(childPath(path, "enter"), `Enter motion ${JSON.stringify(m.enter)} is not supported.`, `Use one of: ${ENTER_MOTIONS.join(", ")}.`);
    }
    if (m.change !== undefined && !(CHANGE_MOTIONS as readonly string[]).includes(m.change as string)) {
      this.error(childPath(path, "change"), `Change motion ${JSON.stringify(m.change)} is not supported.`, `Use one of: ${CHANGE_MOTIONS.join(", ")}.`);
    }
  }

  chart(b: Record<string, unknown>, path: string) {
    if (typeof b.label !== "string" || b.label.trim() === "") {
      this.error(childPath(path, "label"), "Chart has no label.", "Add \"label\": a one-line description of what the chart shows, for example \"Revenue by day\".");
    }
    if (typeof b.kind !== "string" || !CHART_KINDS.includes(b.kind)) {
      this.error(childPath(path, "kind"), `Chart kind ${JSON.stringify(b.kind ?? null)} is not supported.`, `Use one of: ${CHART_KINDS.join(", ")}.`);
    }
    if (typeof b.from !== "string" || b.from === "") {
      this.error(childPath(path, "from"), "Chart has no data source.", "Add \"from\": the name of a source in \"data\", for example \"charges\".");
    }
    for (const k of ["x", "y"]) {
      if (typeof b[k] !== "string" || b[k] === "") this.error(childPath(path, k), `Chart has no ${k}.`, `Add "${k}": an expression per item, for example "{{ item.${k === "x" ? "date" : "amount"} }}".`);
      else this.checkBare(b[k], childPath(path, k));
    }
    this.checkBare(b.series, childPath(path, "series"));
    if (b.aggregate !== undefined && (typeof b.aggregate !== "string" || !AGGREGATES.includes(b.aggregate))) {
      this.error(childPath(path, "aggregate"), `Aggregate ${JSON.stringify(b.aggregate)} is not supported.`, `Use one of: ${AGGREGATES.join(", ")}.`);
    }
  }

  /** The seed rows of the collection a block reads, when `from` names one. */
  seedOf(b: Record<string, unknown>): unknown[] | undefined {
    const src = isObject(this.spec.data) && typeof b.from === "string" ? this.spec.data[b.from] : undefined;
    return isObject(src) && Array.isArray(src.seed) ? src.seed : undefined;
  }

  /** The field a bare or templated expression reads from the item, such as `item.status`. */
  itemField(expr: unknown): string | undefined {
    const m = typeof expr === "string" ? /^\s*(?:\{\{\s*)?item\.([A-Za-z_][A-Za-z0-9_]*)\s*(?:\}\})?\s*$/.exec(expr) : null;
    return m?.[1];
  }

  /** Fields every board and timeline needs: a data source and an expression per item. */
  itemBlock(b: Record<string, unknown>, path: string, name: string, keys: string[]) {
    if (typeof b.label !== "string" || b.label.trim() === "") {
      this.error(childPath(path, "label"), `${name} has no label.`, `Add "label": a short name that people and agents see, for example "${name === "Board" ? "Task board" : "History"}".`);
    }
    if (typeof b.from !== "string" || b.from === "") {
      this.error(childPath(path, "from"), `${name} has no data source.`, "Add \"from\": the name of a source in \"data\", for example \"tasks\".");
    }
    for (const k of keys) {
      if (typeof b[k] !== "string" || b[k] === "") this.error(childPath(path, k), `${name} has no ${k}.`, `Add "${k}": an expression per item, for example "{{ item.${k} }}".`);
      else this.checkBare(b[k], childPath(path, k));
    }
  }

  kanban(b: Record<string, unknown>, path: string) {
    this.itemBlock(b, path, "Board", ["column", "title"]);
    const cols = b.columns;
    const ok = Array.isArray(cols) && cols.length > 0 && cols.every((c) => typeof c === "string" && c !== "") && new Set(cols).size === cols.length;
    if (!ok) {
      this.error(childPath(path, "columns"), "Board has no valid columns.", "Add \"columns\": a list of unique column names, for example [\"todo\", \"doing\", \"done\"].");
    }
    const field = this.itemField(b.column);
    const seed = this.seedOf(b);
    if (ok && field && seed) {
      seed.forEach((row, i) => {
        const v = isObject(row) ? row[field] : undefined;
        if (!(cols as string[]).includes(String(v))) {
          this.error(childPath(childPath(childPath(childPath("$.data", String(b.from)), "seed"), i), field), `Card column ${JSON.stringify(v ?? null)} is not a board column.`, `Use one of: ${(cols as string[]).join(", ")}.`);
        }
      });
    }
    if (b.onMove !== undefined) {
      const a = isObject(b.onMove) ? b.onMove.action : undefined;
      if (typeof a !== "string" || !(isObject(this.spec.actions) && a in this.spec.actions)) {
        this.error(childPath(childPath(path, "onMove"), "action"), `Move action ${JSON.stringify(a ?? null)} is not declared.`, "Name an action from \"actions\", for example \"move_task\"; it receives the column in {{ column }}.");
      }
    }
  }

  timeline(b: Record<string, unknown>, path: string) {
    this.itemBlock(b, path, "Timeline", ["date", "title"]);
    const field = this.itemField(b.date);
    const seed = this.seedOf(b);
    if (field && seed) {
      seed.forEach((row, i) => {
        const v = isObject(row) ? row[field] : undefined;
        const d = typeof v === "string" ? v.slice(0, 10) : "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) {
          this.error(childPath(childPath(childPath(childPath("$.data", String(b.from)), "seed"), i), field), `Entry date ${JSON.stringify(v ?? null)} is not a date.`, "Use a date like 2026-11-07, or a date and time like 2026-11-07T09:30.");
        }
      });
    }
  }

  /** An optional `onSelect` must name a declared action. */
  onSelect(b: Record<string, unknown>, path: string) {
    if (b.onSelect === undefined) return;
    const a = isObject(b.onSelect) ? b.onSelect.action : undefined;
    if (typeof a !== "string" || !(isObject(this.spec.actions) && a in this.spec.actions)) {
      this.error(childPath(childPath(path, "onSelect"), "action"), `Select action ${JSON.stringify(a ?? null)} is not declared.`, "Name an action from \"actions\"; it receives the event or pin in {{ item }}.");
    }
  }

  seedPath(b: Record<string, unknown>, i: number, field: string) {
    return childPath(childPath(childPath(childPath("$.data", String(b.from)), "seed"), i), field);
  }

  calendar(b: Record<string, unknown>, path: string) {
    this.itemBlock(b, path, "Calendar", ["date", "title"]);
    if (b.view !== undefined && !(CALENDAR_VIEWS as readonly unknown[]).includes(b.view)) {
      this.error(childPath(path, "view"), `Calendar view ${JSON.stringify(b.view)} is not supported.`, `Use one of: ${CALENDAR_VIEWS.join(", ")}.`);
    }
    if (typeof b.at === "string" && !b.at.includes("{{") && !isDay(b.at)) {
      this.error(childPath(path, "at"), `Calendar start ${JSON.stringify(b.at)} is not a date.`, "Use a date like 2026-11-07, or an expression in {{ }}.");
    }
    const field = this.itemField(b.date);
    const seed = this.seedOf(b);
    if (field && seed) {
      seed.forEach((row, i) => {
        const v = isObject(row) ? row[field] : undefined;
        if (!(typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(v) && isDay(v.slice(0, 10)))) {
          this.error(this.seedPath(b, i, field), `Event date ${JSON.stringify(v ?? null)} is not a date.`, "Use a date like 2026-11-07, or a date and time like 2026-11-07T09:30.");
        }
      });
    }
    this.onSelect(b, path);
  }

  map(b: Record<string, unknown>, path: string) {
    this.itemBlock(b, path, "Map", ["lat", "lng", "title"]);
    const lat = this.itemField(b.lat), lng = this.itemField(b.lng);
    const seed = this.seedOf(b);
    if (seed) {
      seed.forEach((row, i) => {
        for (const [f, kind] of [[lat, "latitude"], [lng, "longitude"]] as const) {
          if (!f) continue;
          const v = isObject(row) ? row[f] : undefined;
          const other = f === lat ? validCoords(v, 0) : validCoords(0, v);
          if (!other) this.error(this.seedPath(b, i, f), `Pin ${kind} ${JSON.stringify(v ?? null)} is not valid.`, kind === "latitude" ? "Use a number from -90 to 90." : "Use a number from -180 to 180.");
        }
      });
    }
    this.onSelect(b, path);
  }

  checkScreens() {
    const screens = this.spec.screens;
    if (!Array.isArray(screens)) return;
    if (screens.length > MAX_SCREENS) {
      this.error("$.screens", `The app has ${screens.length} screens; the limit is ${MAX_SCREENS}.`, "Merge screens or remove ones nobody needs.");
    }
    screens.forEach((s, i) => {
      if (!isObject(s)) return;
      const p = childPath("$.screens", i);
      const stats: ScreenStats = { sizes: new Set(), spacing: new Set() };
      this.walkBlocks(s.body, childPath(p, "body"), stats);
      if (stats.sizes.size > 3) {
        this.warn(p, `This screen uses ${stats.sizes.size} type sizes; more than 3 looks cluttered.`, "Reuse the same text variants or font sizes.");
      }
      if (stats.spacing.size > 4) {
        this.warn(p, `This screen uses ${stats.spacing.size} different spacing values.`, "Use spacing tokens (sm, md, lg) instead of custom numbers.");
      }
    });
    if (this.blocks > MAX_BLOCKS) {
      this.error("$.screens", `The app has ${this.blocks} blocks; the limit is ${MAX_BLOCKS}.`, "Use lists with an item template instead of repeating blocks.");
    }
  }
}

interface ScreenStats {
  sizes: Set<string>;
  spacing: Set<number>;
}

/** The JSON Schema for shipvo.app/v0. */
export const appSpecSchema = schema;

/**
 * Checks an app spec. Never throws: any input gives a result.
 * CEL expressions are checked for syntax, cost, and unknown names, fields and functions.
 */
export function validate(spec: unknown): ValidationResult {
  try {
    if (!isObject(spec)) {
      return {
        errors: [{ path: "$", message: "The spec must be a JSON object.", fix: "Start with { \"spec\": \"shipvo.app/v0\", \"app\": {...}, \"screens\": [...] }." }],
        warnings: []
      };
    }
    const run = new Run(spec);
    checkSchema(schema, schema, spec, "$", run.errors);
    run.scanStrings(spec, "$");
    run.checkData();
    run.checkActions();
    run.checkTheme();
    run.checkScreens();
    run.checkStrings();
    return { errors: run.errors, warnings: run.warnings };
  } catch (e) {
    return {
      errors: [{ path: "$", message: `The validator could not read this spec: ${e instanceof Error ? e.message : "unknown problem"}.`, fix: "Check that the spec is plain JSON." }],
      warnings: []
    };
  }
}
