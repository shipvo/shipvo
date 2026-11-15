// The approval guard: taps a person should agree to before an agent makes them. Off unless SHIPVO_GUARD names the kinds to ask about.
// Pure functions, no I/O.
export type GuardKind = "pay" | "delete" | "send";

const LABELS: Record<GuardKind, RegExp> = {
  pay: /^(pay(\s+(now|with\b.*|\S*\d[\d.,]*\S*))?|buy(\s+(now|with\b.*))?|place (your )?order|confirm (purchase|payment|order)|complete (purchase|order)|start subscription|subscribe( now)?|transfer|send money|purchase)$/i,
  delete: /^(delete (my |your )?account|close (my |your )?account|delete everything|erase all data)$/i,
  send: /^(send|post|publish|reply|share|submit review)$/i,
};
const KINDS = Object.keys(LABELS) as GuardKind[];

/** The kinds to ask about, from SHIPVO_GUARD: a comma list of pay, delete and send; "on" means pay and delete. Empty when off. */
export function guardKinds(value: string | undefined): GuardKind[] {
  const v = (value ?? "").trim().toLowerCase();
  if (!v || v === "off" || v === "0" || v === "false") return [];
  if (v === "on" || v === "1" || v === "true" || v === "ask") return ["pay", "delete"];
  return [...new Set(v.split(",").map((s) => s.trim()).filter((s): s is GuardKind => (KINDS as string[]).includes(s)))];
}

/** The kind of tap a label is, among `kinds`, or undefined when the tap needs no approval. */
export function guardedKind(label: string | undefined, kinds: readonly GuardKind[]): GuardKind | undefined {
  const l = (label ?? "").replace(/\s+/g, " ").trim();
  return l ? kinds.find((k) => LABELS[k].test(l)) : undefined;
}

const WHAT: Record<GuardKind, string> = { pay: "spends money", delete: "deletes an account or its data", send: "sends or publishes something" };
/** The question a person is asked before a guarded tap. */
export const guardQuestion = (label: string, kind: GuardKind, app: string) => `The agent wants to tap "${label}" in ${app}. This ${WHAT[kind]}. Allow it?`;
