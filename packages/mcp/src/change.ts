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

// Added (+), removed (-) and changed (~) lines. A removed and an added line with the same ref are one element whose
// text changed, shown as "~ old → new". Added and changed lines keep their refs from the new tree, so refs stay valid.
export function compactDiff(prev: string, next: string): string {
  const count = (ls: string[]) => { const m = new Map<string, number>(); for (const l of ls) m.set(norm(l), (m.get(norm(l)) ?? 0) + 1); return m; };
  const pl = lines(prev), nl = lines(next);
  const pc = count(pl), nc = count(nl);
  const gone: string[] = [], came: string[] = [];
  for (const l of pl) { const n = nc.get(norm(l)) ?? 0; if (n > 0) nc.set(norm(l), n - 1); else gone.push(l.trim()); }
  for (const l of nl) { const n = pc.get(norm(l)) ?? 0; if (n > 0) pc.set(norm(l), n - 1); else came.push(l.trim()); }
  const refOf = (l: string) => /\[ref=(\w+)\]/.exec(l)?.[1];
  const byRef = new Map<string, string>();
  for (const l of gone) { const r = refOf(l); if (r && !byRef.has(r)) byRef.set(r, l); }
  const out: string[] = [], paired = new Set<string>();
  const adds: string[] = [];
  for (const l of came) { const r = refOf(l), was = r ? byRef.get(r) : undefined; if (r && was !== undefined && !paired.has(r)) { paired.add(r); adds.push(`~ ${was.replace(/^- /, "")} → ${l.replace(/^- /, "")}`); } else adds.push("+ " + l); }
  for (const l of gone) { const r = refOf(l); if (!(r && paired.has(r) && byRef.get(r) === l)) out.push("- " + l); }
  out.push(...adds);
  return out.length ? out.join("\n") : "(same lines, new order)";
}

/** The ref of the element a path step names: the step itself when it is a ref on the screen, else the one element with that visible name. */
export function refForStep(tree: string, step: string): { ref: string } | { error: string } {
  const all = lines(tree);
  if (/^(?:p\d+|f\d+)?e\d+$/.test(step)) return all.some((l) => l.includes(`[ref=${step}]`)) ? { ref: step } : { error: `no element with ref ${step} on the screen` };
  const want = step.trim().toLowerCase();
  const named = all.map((l) => ({ ref: /\[ref=(\w+)\]/.exec(l)?.[1], name: (/"((?:[^"\\]|\\.)*)"/.exec(l)?.[1] ?? /\]:\s*(.+)$/.exec(l)?.[1] ?? "").trim().toLowerCase() })).filter((x) => x.ref && x.name);
  const exact = named.filter((x) => x.name === want), hits = exact.length ? exact : named.filter((x) => x.name.includes(want));
  if (hits.length === 1) return { ref: hits[0]!.ref! };
  return { error: hits.length ? `${hits.length} elements are named "${step}": pass the ref of the one you mean` : `nothing named "${step}" on the screen` };
}

// The value of the field with this ref: the text after its attribute brackets and ":".
// Handles more attributes after the ref ([ref=e3] [cursor=pointer]: Ana) and YAML-quoted lines.
export function fieldValue(tree: string, ref: string): string | undefined {
  for (const raw of lines(tree)) {
    const q = /^(\s*- )'(.*)'(:.*)?$/.exec(raw);
    const l = (q ? q[1] + q[2]!.replace(/''/g, "'") + (q[3] ?? "") : raw).trim();
    const m = new RegExp(`\\[ref=${ref}\\]((?: \\[[^\\]]*\\])*)(?::\\s*(.*))?$`).exec(l);
    if (m) return (m[2] ?? "").trim().replace(/^"(.*)"$/, "$1");
  }
  return undefined;
}
