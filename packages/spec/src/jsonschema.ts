import { childPath, isObject, type Issue } from "./types.js";

type Schema = Record<string, any>;

const MAX_DEPTH = 64;

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

export function closest(word: string, options: string[]): string | undefined {
  let best: string | undefined;
  let bestD = Math.max(2, Math.floor(word.length / 3)) + 1;
  for (const o of options) {
    const d = distance(word.toLowerCase(), o.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function matchesType(v: unknown, t: string): boolean {
  const actual = typeOf(v);
  return actual === t || (t === "number" && actual === "integer");
}

function show(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    if (s === undefined) return String(v);
    return s.length > 60 ? s.slice(0, 57) + "..." : s;
  } catch {
    return "(value)";
  }
}

/** A small JSON Schema interpreter: the keywords the app spec schema uses, with fix hints. */
export function checkSchema(root: Schema, schema: Schema, value: unknown, path: string, out: Issue[], depth = 0): void {
  if (depth > MAX_DEPTH) {
    out.push({ path, message: "Nested too deeply.", fix: "Flatten this part of the spec." });
    return;
  }
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.replace("#/$defs/", "");
    const target = root.$defs?.[name];
    if (target) checkSchema(root, target, value, path, out, depth + 1);
    return;
  }
  if ("const" in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    out.push({ path, message: `Must be ${show(schema.const)}, got ${show(value)}.`, fix: `Set this to ${show(schema.const)}.` });
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e: unknown) => e === value)) {
    const near = typeof value === "string" ? closest(value, schema.enum.filter((e: unknown) => typeof e === "string")) : undefined;
    out.push({
      path,
      message: `${show(value)} is not allowed here.`,
      fix: near ? `Did you mean ${show(near)}? Allowed: ${schema.enum.map(show).join(", ")}.` : `Use one of: ${schema.enum.map(show).join(", ")}.`
    });
    return;
  }
  if (schema.type !== undefined) {
    const types: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      out.push({ path, message: `Expected ${types.join(" or ")}, got ${typeOf(value)}.`, fix: `Replace this with a ${types.join(" or ")}.` });
      return;
    }
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      out.push({ path, message: `Too short (minimum ${schema.minLength} characters).`, fix: "Write a longer value." });
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      out.push({ path, message: `Too long (${value.length} characters, maximum ${schema.maxLength}).`, fix: `Shorten this to ${schema.maxLength} characters or fewer.` });
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
      out.push({ path, message: `${show(value)} does not match the required format.`, fix: `Use a value that matches ${schema.pattern}.` });
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      out.push({ path, message: `${value} is below the minimum ${schema.minimum}.`, fix: `Use ${schema.minimum} or more.` });
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      out.push({ path, message: `${value} is above the maximum ${schema.maximum}.`, fix: `Use ${schema.maximum} or less.` });
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      out.push({ path, message: `Needs at least ${schema.minItems} item(s).`, fix: "Add the missing item." });
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      out.push({ path, message: `Has ${value.length} items, maximum ${schema.maxItems}.`, fix: "Remove items." });
    }
    if (schema.items) value.forEach((item, i) => checkSchema(root, schema.items, item, childPath(path, i), out, depth + 1));
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (typeof schema.minProperties === "number" && keys.length < schema.minProperties) {
      out.push({ path, message: "This object is empty.", fix: "Add at least one property." });
    }
    const props: Schema = schema.properties ?? {};
    for (const req of schema.required ?? []) {
      if (!(req in value)) {
        out.push({ path: childPath(path, req), message: `Missing required "${req}".`, fix: `Add "${req}" here.` });
      }
    }
    const patterns: [RegExp, Schema][] = Object.entries<Schema>(schema.patternProperties ?? {}).map(([p, s]) => [new RegExp(p), s]);
    for (const key of keys) {
      const sub = childPath(path, key);
      const v = value[key];
      if (Object.prototype.hasOwnProperty.call(props, key)) {
        checkSchema(root, props[key], v, sub, out, depth + 1);
        continue;
      }
      const hit = patterns.find(([re]) => re.test(key));
      if (hit) {
        checkSchema(root, hit[1], v, sub, out, depth + 1);
        continue;
      }
      const extra = schema.additionalProperties;
      if (extra === false) {
        const known = [...Object.keys(props), ...(schema.required ?? [])];
        const near = closest(key, known);
        const keyPatternOnly = patterns.length > 0 && known.length === 0;
        out.push({
          path: sub,
          message: keyPatternOnly ? `The name "${key}" is not allowed.` : `Unknown key "${key}".`,
          fix: keyPatternOnly
            ? `Rename it to match ${patterns.map(([re]) => re.source).join(" or ")}.`
            : near ? `Did you mean "${near}"? Otherwise remove "${key}".` : `Remove "${key}".`
        });
      } else if (isObject(extra)) {
        checkSchema(root, extra, v, sub, out, depth + 1);
      }
    }
  }
  for (const part of schema.allOf ?? []) {
    if (part.if) {
      const probe: Issue[] = [];
      checkSchema(root, part.if, value, path, probe, depth + 1);
      if (probe.length === 0 && part.then) checkSchema(root, part.then, value, path, out, depth + 1);
    } else {
      checkSchema(root, part, value, path, out, depth + 1);
    }
  }
}
