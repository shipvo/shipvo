import { parseScreen } from "./tree.js";
import type { Node } from "./tree.js";
import type { Step } from "./steps.js";

export type Repair =
  | { kind: "repaired"; step: Step; reason: string }
  | { kind: "unresolved"; candidates: Node[] };

const TEXT_ROLES = ["textbox", "searchbox", "spinbutton", "combobox"];
const TAP_ROLES = ["button", "link", "tab", "checkbox", "switch", "radio", "menuitem", "option"];
const label = (n: Node) => n.name || n.text;
const norm = (s: string) => s.trim().toLowerCase();

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}
/** 1 for equal names, towards 0 for unrelated ones. A name that contains the other counts as close. */
function similarity(a: string, b: string): number {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const contained = a.includes(b) || b.includes(a) ? 0.5 + 0.5 * (Math.min(a.length, b.length) / Math.max(a.length, b.length)) : 0;
  return Math.max(contained, 1 - distance(a, b) / Math.max(a.length, b.length));
}
const CLOSE = 0.5;

/**
 * Propose a fix for a failed `tap` or `type` step, given the current accessibility tree (a screen string or parsed nodes).
 * Returns `repaired` when exactly one element with the right role has the closest name. Returns `unresolved`, with the
 * nearby candidates, when there is none, several are equally close, or the best match has a different role.
 * A repaired step is the same step with a new target: its text, enter flag and line are kept. Other step kinds are always `unresolved`.
 * This function never removes or skips a step.
 */
export function proposeRepair(step: Step, tree: string | Node[]): Repair {
  const nodes = typeof tree === "string" ? parseScreen(tree) : tree;
  if (step.kind !== "tap" && step.kind !== "type") return { kind: "unresolved", candidates: [] };
  const roles = step.role ? [step.role] : step.kind === "type" ? TEXT_ROLES : TAP_ROLES;
  const scored = nodes
    .filter((n) => label(n) !== "")
    .map((n) => ({ n, s: similarity(step.target, label(n)) }))
    .filter((x) => x.s >= CLOSE)
    .sort((a, b) => b.s - a.s);
  const sameRole = scored.filter((x) => roles.includes(x.n.role));
  if (sameRole.length === 0) return { kind: "unresolved", candidates: scored.map((x) => x.n) };
  const top = sameRole.filter((x) => x.s === sameRole[0]!.s);
  if (top.length > 1) return { kind: "unresolved", candidates: top.map((x) => x.n) };
  const best = top[0]!.n;
  // A closer match with another role means the role changed: do not guess.
  if (scored[0]!.s > top[0]!.s) return { kind: "unresolved", candidates: scored.map((x) => x.n) };
  if (label(best) === step.target) return { kind: "unresolved", candidates: [best] };
  return {
    kind: "repaired",
    step: { ...step, target: label(best) },
    reason: `${step.kind} target "${step.target}" is now "${label(best)}" (${best.role}, ref ${best.ref})`,
  };
}
