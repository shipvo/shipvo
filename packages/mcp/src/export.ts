// Turn the steps of an MCP session into a @shipvo/test script. Pure functions, no I/O.
// Refs change between sessions, so a step keeps the target's visible text, never its ref.
export type Step =
  | { kind: "tap"; label: string; problem?: string; wait?: string }
  | { kind: "type"; label: string; text: string; enter?: boolean; secret?: boolean; problem?: string; wait?: string }
  | { kind: "scroll"; direction: string; on?: { label: string; problem?: string }; wait?: string }
  | { kind: "back"; wait?: string }
  | { kind: "device"; settings: Record<string, unknown> }
  | { kind: "manual"; what: string };

export type OpenInfo = { app: string; dark?: boolean; seedCart?: unknown[] };
type Item = { role: string; label: string };

const LINE = /^\s*- ([\w-]+)(?: "((?:[^"\\]|\\.)*)")?((?: \[[^\]]*\])*)(?::\s*(.*))?$/;
const unq = (s: string) => s.replace(/\\(.)/g, "$1");
// Elements of a screen tree that have a ref: role, visible label (name, else text) and ref.
export function items(tree: string): (Item & { ref: string })[] {
  const out: (Item & { ref: string })[] = [];
  for (const raw of tree.split("\n")) {
    const q = /^(\s*- )'(.*)'(:?)$/.exec(raw);
    const m = LINE.exec(q ? q[1] + q[2]!.replace(/''/g, "'") + q[3] : raw);
    if (!m) continue;
    const ref = /\[ref=(\w+)\]/.exec(m[3] ?? "")?.[1];
    if (!ref) continue;
    let text = (m[4] ?? "").trim();
    if (/^".*"$/.test(text)) text = unq(text.slice(1, -1));
    out.push({ role: m[1]!, label: (m[2] === undefined ? "" : unq(m[2])) || (FIELDS.includes(m[1]!) ? "" : text), ref });
  }
  return out;
}

const FIELDS = ["textbox", "searchbox", "spinbutton", "combobox"];
const SECRET = /\b(password|passcode|pin|pwd|secret|token|cvv|cvc|otp)\b|one-time code|verification code|card number|security code/i;

// Find the element with this ref and say whether @shipvo/test would resolve its label to exactly one element
// (an exact match wins, else a case-insensitive substring: the same rule as `find` in @shipvo/test).
export function target(tree: string | undefined, ref: string | undefined, fieldsOnly = false): { label: string; role: string; problem?: string } {
  const all = tree ? items(tree) : [];
  const el = all.find((i) => i.ref === ref);
  if (!el || !el.label) return { label: "", role: el?.role ?? "", problem: `no visible text for ${ref ?? "the target"}; this step cannot be replayed by text` };
  const pool = all.filter((i) => i.label && (!fieldsOnly || FIELDS.includes(i.role)));
  let n = pool.filter((i) => i.label === el.label).length;
  if (n === 0) n = pool.filter((i) => i.label.toLowerCase().includes(el.label.toLowerCase())).length;
  return n === 1 ? { label: el.label, role: el.role } : { label: el.label, role: el.role, problem: `ambiguous: ${n} elements match "${el.label}"; pick one by role and name` };
}
export const isSecret = (label: string, role = "") => SECRET.test(label) || /password/i.test(role);

// Text to wait for after a step: the first heading, else the first element, that was not on the screen before.
export function waitText(prev: string | undefined, next: string, avoid: string[] = []): string | undefined {
  const seen = new Set(prev ? items(prev).map((i) => i.label) : []);
  const fresh = items(next).filter((i) => i.label && !seen.has(i.label) && !avoid.includes(i.label) && i.label.length <= 80);
  return (fresh.find((i) => i.role === "heading") ?? fresh[0])?.label;
}

// A payment PIN is a secret: the script reads it from the environment.
export const redactDevice = (d: Record<string, unknown>): Record<string, unknown> => {
  const pay = d.payment as Record<string, unknown> | undefined;
  return pay && pay.pin !== undefined ? { ...d, payment: { ...pay, pin: "__ENV_SHIPVO_TEST_PAYMENT_PIN__" } } : d;
};
const q = (s: string) => JSON.stringify(s);
const envName = (label: string) => "SHIPVO_TEST_" + (label.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "") || "SECRET");
const todo = (p: string) => `  // TODO: ${p.replace(/[\r\n]+/g, " ")}`;

export function exportTest(open: OpenInfo, steps: Step[]): string {
  const opts: string[] = [`app: ${q(open.app)}`];
  if (open.dark) opts.push("dark: true");
  if (open.seedCart?.length) opts.push(`seedCart: ${JSON.stringify(open.seedCart)}`);
  const L: string[] = [
    `import { test } from "vitest";`,
    `import { openApp } from "@shipvo/test";`,
    ``,
    `test(${q("exported from an MCP session on " + open.app)}, async () => {`,
    `  const phone = await openApp({ ${opts.join(", ")} });`,
  ];
  const wait = (w?: string) => { if (w) L.push(`  await phone.waitFor(${q(w)});`); };
  for (const s of steps) {
    if (s.kind === "tap") {
      if (s.problem) L.push(todo(s.problem) + " (tap)"); else { L.push(`  await phone.tap(${q(s.label)});`); wait(s.wait); }
    } else if (s.kind === "type") {
      if (s.problem) { L.push(todo(s.problem) + " (type)"); continue; }
      const val = s.secret ? `process.env.${envName(s.label)}!` : q(s.text);
      L.push(`  await phone.type(${q(s.label)}, ${val}${s.enter ? ", { enter: true }" : ""});`); wait(s.wait);
    } else if (s.kind === "scroll") {
      if (s.on?.problem) { L.push(todo(s.on.problem) + " (scroll)"); continue; }
      L.push(`  await phone.scroll(${q(s.direction)}${s.on ? `, ${q(s.on.label)}` : ""});`); wait(s.wait);
    } else if (s.kind === "back") {
      L.push(`  await phone.back();`); wait(s.wait);
    } else if (s.kind === "manual") {
      L.push(todo(`not exported: ${s.what} (replay by hand)`));
    } else L.push(`  await phone.device.set(${JSON.stringify(s.settings).replace(/"__ENV_(\w+)__"/g, "process.env.$1!")});`);
  }
  L.push(`});`, ``);
  return L.join("\n");
}
