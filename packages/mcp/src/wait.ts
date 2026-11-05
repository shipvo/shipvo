// wait_for and settle: pure matching on screen trees. No I/O.
import { parse, unquoteLine } from "./record.js";

export type WaitFor = { ref?: string; text?: string; role?: string; name?: string; gone?: boolean };
export type Waited = { matched: boolean; ms: number };

// True when the thing wait_for describes is on the screen (ignoring `gone`).
export function present(tree: string, w: WaitFor): boolean {
  const ls = tree.split("\n").filter((l) => l.trim());
  if (w.ref) return ls.some((l) => unquoteLine(l).includes(`[ref=${w.ref}]`));
  if (w.text) return ls.some((l) => (parse(l)?.text ?? "").includes(w.text!));
  if (w.role && w.name) return ls.some((l) => { const p = parse(l); return !!p && p.role === w.role && p.text.includes(w.name!); });
  return false;
}
export const wantsMatch = (w: WaitFor) => !!(w.ref || w.text || (w.role && w.name));
export const satisfied = (tree: string, w: WaitFor) => present(tree, w) !== !!w.gone;

// Two reads are equal when they differ only in ref numbers.
export const sameTree = (a: string, b: string) => a.replace(/\s*\[ref=\w+\]/g, "") === b.replace(/\s*\[ref=\w+\]/g, "");
