/** Name checks for CEL expressions: unknown names, fields and functions, with a "did you mean" suggestion. */
import { parse } from "@bufbuild/cel";
import { LIBRARY_ARITY } from "./eval.js";

/** What an expression may refer to at one place in the spec. `undefined` means "anything": not checked. */
export interface NameScope {
  /** Top-level names, each with its known fields (or undefined when the fields are not known). */
  names: Record<string, string[] | undefined>;
  /** Do not report unknown names (used where the names depend on a server response). */
  loose?: boolean;
}

const GLOBAL_FUNCS = new Set([...Object.keys(LIBRARY_ARITY), "int", "uint", "double", "string", "bytes", "bool", "type", "dyn", "duration", "timestamp", "matches", "has", "size"]);
const MEMBER_FUNCS = new Set(["contains", "startsWith", "endsWith", "matches", "size"]);
const PERSON = ["locale", "timeZone", "language"];
/** Names that exist in every expression. */
export const BUILTIN_NAMES: Record<string, string[] | undefined> = { now: undefined, person: PERSON };

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}

/** The closest candidate, if it is close enough to be a typo. */
export function suggest(name: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = distance(name.toLowerCase(), c.toLowerCase());
    if (d < bestD) { best = c; bestD = d; }
  }
  return best !== undefined && bestD <= Math.max(2, Math.floor(Math.max(name.length, best.length) / 3)) ? best : undefined;
}

type E = { exprKind: { case?: string; value?: any } };

/** Returns the problems in one expression (`message` and `fix`). Syntax errors are left to the syntax check. */
export function checkNames(src: string, scope: NameScope): { message: string; fix: string }[] {
  const problems: { message: string; fix: string }[] = [];
  let root: E;
  try { root = parse(src).expr as unknown as E; } catch { return problems; }
  const names = { ...BUILTIN_NAMES, ...scope.names };
  const unknown = (what: string, name: string, pool: string[]) => {
    const s = suggest(name, pool);
    problems.push({
      message: `Unknown ${what} "${name}".`,
      fix: s ? `Did you mean "${s}"?` : pool.length ? `Use one of: ${pool.slice(0, 12).join(", ")}.` : `There is nothing to refer to here.`
    });
  };
  // Dotted path rooted at a name, like data.charges or route.params.id; undefined for anything else.
  const dotted = (e: E): string[] | undefined => {
    const k = e.exprKind;
    if (k.case === "identExpr") return [k.value.name];
    if (k.case === "selectExpr") { const p = dotted(k.value.operand); return p && [...p, k.value.field]; }
    return undefined;
  };
  const visit = (e: E | undefined, bound: Set<string>): void => {
    if (!e) return;
    const k = e.exprKind;
    switch (k.case) {
      case "identExpr": {
        const n = k.value.name as string;
        if (!bound.has(n) && !(n in names) && !scope.loose) unknown("name", n, Object.keys(names));
        break;
      }
      case "selectExpr": {
        const p = dotted(e);
        if (p && p.length === 2 && !bound.has(p[0]!)) {
          const fields = names[p[0]!];
          if (fields && !scope.loose && !fields.includes(p[1]!) && !k.value.testOnly) unknown("field", p[1]!, fields);
        }
        visit(k.value.operand, bound);
        break;
      }
      case "listExpr": k.value.elements.forEach((x: E) => visit(x, bound)); break;
      case "structExpr": k.value.entries.forEach((x: any) => { visit(x.keyKind?.value, bound); visit(x.value, bound); }); break;
      case "callExpr": {
        const c = k.value;
        const n = c.function as string;
        if (!/^[_@!]/.test(n) && !(c.target ? MEMBER_FUNCS.has(n) : GLOBAL_FUNCS.has(n))) {
          unknown("function", n, c.target ? [...MEMBER_FUNCS] : [...GLOBAL_FUNCS].filter((f) => f in LIBRARY_ARITY));
        } else if (!c.target && LIBRARY_ARITY[n]) {
          const [lo, hi] = LIBRARY_ARITY[n]!;
          if (c.args.length < lo || c.args.length > hi) {
            problems.push({ message: `${n}() takes ${lo === hi ? lo : `${lo} to ${hi}`} argument${hi === 1 ? "" : "s"}, not ${c.args.length}.`, fix: `Call it with ${lo === hi ? lo : `${lo} to ${hi}`} argument${hi === 1 ? "" : "s"}.` });
          }
        }
        visit(c.target, bound);
        c.args.forEach((x: E) => visit(x, bound));
        break;
      }
      case "comprehensionExpr": {
        const c = k.value;
        visit(c.iterRange, bound);
        visit(c.accuInit, bound);
        const inner = new Set([...bound, c.iterVar, c.accuVar]);
        [c.loopCondition, c.loopStep, c.result].forEach((x: E) => visit(x, inner));
        break;
      }
    }
  };
  visit(root, new Set());
  return problems;
}
