// Checks the running Node against the `engines.node` range of Expo (`^22.13.0 || ^24.3.0 || >=26.0.0`).
// Only `^x.y.z`, `>=x.y.z` and `x.y.z` terms joined by `||` are read; anything else means "no opinion".

/** Expo major to its `engines.node` range, for init, which has not installed Expo yet. */
export const EXPO_NODE_RANGES: Record<number, string> = { 58: "^22.13.0 || ^24.3.0 || >=26.0.0" };

type Term = { op: "^" | ">="; v: [number, number, number] };

function parseRange(range: string): Term[] | null {
  const terms: Term[] = [];
  for (const part of range.split("||")) {
    const m = part.trim().match(/^(\^|>=)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
    if (!m) return null;
    terms.push({ op: m[1] === ">=" ? ">=" : "^", v: [Number(m[2]), Number(m[3] ?? 0), Number(m[4] ?? 0)] });
  }
  return terms.length ? terms : null;
}

const cmp = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function parseVersion(v: string): [number, number, number] | null {
  const m = v.trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

/** True when `version` satisfies `range`. Returns true if either cannot be read. */
export function nodeInRange(version: string, range: string): boolean {
  const v = parseVersion(version), terms = parseRange(range);
  if (!v || !terms) return true;
  return terms.some((t) => cmp(v, t.v) >= 0 && (t.op === ">=" || v[0] === t.v[0]));
}

/** A short warning when `version` is outside `range`, or null when it is inside (or unreadable). */
export function nodeRangeWarning(version: string, range: string, label: string): string | null {
  if (nodeInRange(version, range)) return null;
  const terms = parseRange(range)!;
  const v = parseVersion(version)!;
  const list = terms.map((t) => `${t.v[0]}.${t.v[1]}`.replace(/\.0$/, "") + "+").join(", ");
  const carets = terms.filter((t) => t.op === "^").map((t) => t.v[0]);
  const use = carets.length ? ` Use Node ${Math.max(...carets)} LTS.` : "";
  return `Node ${v[0]}.${v[1]} is outside ${label}'s supported range (${list}).${use}`;
}
