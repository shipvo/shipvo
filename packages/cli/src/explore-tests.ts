// `exportTest`: turn an explore finding into a `@shipvo/test` file that replays its steps and fails while the bug exists.
// Text from the app under test is hostile input. It goes into the file only as a JSON string literal (with U+2028 and
// U+2029 escaped), never into a comment. Comments hold fixed text and the finding kind from a closed list.
import type { Finding, Kind, Step } from "./explore.js";

const KINDS: readonly Kind[] = ["error", "not_delivered", "action_failed", "dead_end", "unnamed", "small_target", "duplicate_name", "network_failed", "stuck_loading", "blank_screen"];

const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
/** A JSON string literal that is safe in any JS source: line separators are escaped too. */
const lit = (v: string): string => JSON.stringify(String(v)).split(LS).join("\\u2028").split(PS).join("\\u2029");

function stepLine(s: Step): string {
  switch (s.action) {
    case "open": return "";
    case "open_url": return `  await phone.openUrl(${lit(s.url)});`;
    case "tap": return `  await phone.tap({ role: ${lit(s.role)}, name: ${lit(s.name)}${s.nth ? `, nth: ${Number(s.nth) | 0}` : ""} });`;
    case "type": return `  await phone.type({ role: ${lit(s.role)}, name: ${lit(s.name)}${s.nth ? `, nth: ${Number(s.nth) | 0}` : ""} }, ${lit(s.text)}${s.enter ? ", { enter: true }" : ""});`;
    case "back": return "  await phone.back();";
    default: return "";
  }
}

/** What must be true once the steps are replayed. Fixed code only. */
const CHECK: Partial<Record<Kind, string[]>> = {
  error: ["  expect(phone.sees(/Uncaught \\w*Error|Unhandled Runtime Error|Application error|Something went wrong/i)).toBe(false);"],
  blank_screen: ["  expect(phone.screen.trim()).not.toBe(\"\");"],
  stuck_loading: ["  await phone.waitForGone(/loading/i);"],
  unnamed: ["  expect(phone.nodes().filter((n) => [\"button\", \"link\"].includes(n.role) && !n.name.trim())).toEqual([]);"],
  dead_end: ["  expect(phone.nodes().some((n) => /^(back|go back|close)$/i.test(n.name))).toBe(true);"],
};

/** Source of a `@shipvo/test` file that replays the finding's steps and fails while the bug exists. */
export function exportTest(finding: Finding): string {
  const kind: Kind = KINDS.includes(finding.kind) ? finding.kind : "error";
  const steps = finding.steps.map(stepLine).filter(Boolean);
  const out = [
    "// Written by shipvo explore.",
    `// Finding kind: ${kind}`,
    'import { test, expect } from "@shipvo/test/vitest";',
    "",
    `test(${lit(`explore: ${kind}`)}, async ({ phone }) => {`,
    ...steps,
    ...(CHECK[kind] ?? []),
    "});",
    "",
  ];
  return out.join("\n");
}
