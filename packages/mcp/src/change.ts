// Compare the previous and new screen tree of a session. Pure functions, no I/O.
export type Change = "none" | "content changed" | "new screen" | "scrolled";

const REF = /\s*\[ref=\w+\]/g;
// A line without its ref, so a re-numbered but identical element counts as the same.
const norm = (l: string) => l.replace(REF, "").trim();
const lines = (t: string) => t.split("\n").filter((l) => l.trim());

export function classify(prev: string | undefined, next: string, action: string): Change {
  if (prev === undefined) return "new screen";
  const a = lines(prev).map(norm), b = lines(next).map(norm);
  if (a.length === b.length && a.every((l, i) => l === b[i])) return "none";
  if (action === "scroll") return "scrolled";
  const seen = new Set(a);
  const kept = b.filter((l) => seen.has(l)).length;
  return b.length === 0 || kept / b.length < 0.5 ? "new screen" : "content changed";
}

// Added (+) and removed (-) lines. Added lines keep their refs from the new tree, so refs stay valid.
export function compactDiff(prev: string, next: string): string {
  const count = (ls: string[]) => { const m = new Map<string, number>(); for (const l of ls) m.set(norm(l), (m.get(norm(l)) ?? 0) + 1); return m; };
  const pl = lines(prev), nl = lines(next);
  const pc = count(pl), nc = count(nl);
  const out: string[] = [];
  for (const l of pl) { const n = nc.get(norm(l)) ?? 0; if (n > 0) nc.set(norm(l), n - 1); else out.push("- " + l.trim()); }
  for (const l of nl) { const n = pc.get(norm(l)) ?? 0; if (n > 0) pc.set(norm(l), n - 1); else out.push("+ " + l.trim()); }
  return out.join("\n");
}

// The value of the field with this ref: the text after "]:" on its line.
export function fieldValue(tree: string, ref: string): string | undefined {
  for (const l of lines(tree)) {
    const m = new RegExp(`\\[ref=\\w*${ref}\\](?::\\s*(.*))?$`).exec(l.trim());
    if (m) return (m[1] ?? "").replace(/^"(.*)"$/, "$1");
  }
  return undefined;
}
