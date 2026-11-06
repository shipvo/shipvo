// `exportTest`: turn an explore finding into a `@shipvo/test` file that replays its steps and fails while the bug exists.
// Text from the app under test is hostile input. It goes into the file only as a JSON string literal (with U+2028 and
// U+2029 escaped), never into a comment. Comments hold fixed text and the finding kind from a closed list.
import { ACTIONABLE, NETWORK, type Finding, type Kind, type Step } from "./explore.js";

const KINDS: readonly Kind[] = ["error", "not_delivered", "action_failed", "dead_end", "unnamed", "small_target", "duplicate_name", "network_failed", "stuck_loading", "blank_screen"];

const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
/** A JSON string literal that is safe in any JS source: line separators are escaped too. */
const lit = (v: string): string => JSON.stringify(String(v)).split(LS).join("\\u2028").split(PS).join("\\u2029");

/** The element a step acts on: the nth enabled element with this role and name, as the walker counted it. */
const pick = (role: string, name: string, nth: unknown): string =>
  `phone.nodes().filter((n) => n.role === ${lit(role)} && n.name === ${lit(name)} && !n.attrs.includes("disabled"))[${Math.max(0, Number(nth) | 0)}]!.ref`;

function stepLine(s: Step): string {
  switch (s.action) {
    case "open": return "";
    case "open_url": return `  await phone.openUrl(${lit(s.url)});`;
    case "tap": return `  await phone.tap({ ref: ${pick(s.role, s.name, s.nth)} });`;
    case "type": return `  await phone.type({ ref: ${pick(s.role, s.name, s.nth)} }, ${lit(s.text)}${s.enter ? ", { enter: true }" : ""});`;
    case "back": return "  await phone.back();";
    default: return "";
  }
}

const ROLES = `new Set(${JSON.stringify([...ACTIONABLE])})`;
const ACTIVE = `phone.nodes().filter((n) => ${ROLES}.has(n.role) && !n.attrs.includes("disabled"))`;

/** What must be true once the steps are replayed. Fixed code only. Kinds without an entry cannot be checked from the screen alone. */
const CHECK: Partial<Record<Kind, string[]>> = {
  error: ["  expect(phone.sees(/Uncaught \\w*Error|Unhandled Runtime Error|Application error|Something went wrong/i)).toBe(false);"],
  blank_screen: ["  expect(/\"|: \\S/.test(phone.screen)).toBe(true);"],
  stuck_loading: ["  await phone.waitForGone(/loading/i);"],
  unnamed: [`  expect(${ACTIVE}.filter((n) => !n.name.trim())).toEqual([]);`],
  dead_end: [`  expect(${ACTIVE}.length).toBeGreaterThan(0);`],
  network_failed: [`  expect(phone.sees(new RegExp(${lit(NETWORK.source)}, ${lit(NETWORK.flags)}))).toBe(false);`],
  duplicate_name: [`  const names = ${ACTIVE}.filter((n) => n.name).map((n) => n.role + "\\u0000" + n.name);`, "  expect(names.length).toBe(new Set(names).size);"],
};

/** Source of a `@shipvo/test` file that replays the finding's steps and fails while the bug exists.
 * Returns `null` for a kind with no screen check (`not_delivered`, `action_failed`, `small_target`): a file for it would pass on the bug. */
export function exportTest(finding: Finding): string | null {
  const kind: Kind = KINDS.includes(finding.kind) ? finding.kind : "error";
  if (!CHECK[kind]) return null;
  const steps = finding.steps.map(stepLine).filter(Boolean);
  const out = [
    "// Written by shipvo explore.",
    `// Finding kind: ${kind}`,
    'import { test, expect } from "@shipvo/test/vitest";',
    "",
    `test(${lit(`explore: ${kind}`)}, async ({ phone }) => {`,
    ...steps,
    ...CHECK[kind]!,
    "});",
    "",
  ];
  return out.join("\n");
}
