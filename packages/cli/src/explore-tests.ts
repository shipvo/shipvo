// Finding -> `@shipvo/test` file. The test replays the steps, then asserts the bug is gone, so it fails while the bug exists. Pure: tests need no simulator.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describeStep, signature, type Finding, type Step } from "./explore.js";
import { screenName } from "./explore-issues.js";

const q = (s: string) => JSON.stringify(s);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "screen";
const ACTIONABLE = `["button", "link", "textbox", "searchbox", "checkbox", "switch", "tab", "menuitem", "radio", "combobox", "slider"]`;

function stepCode(s: Step): string[] {
  if (s.action === "open") return [];
  if (s.action === "open_url") return [`await phone.openUrl(${q(s.url)});`];
  if (s.action === "back") return ["await phone.back();"];
  const pick = `phone.nodes().filter((n) => n.role === ${q(s.role)} && n.name === ${q(s.name)})[${s.nth}]`;
  const ref = `${pick}?.ref ?? ${q("")}`;
  return s.action === "tap"
    ? [`await phone.tap({ ref: ${ref} });`]
    : [`await phone.act("type", { ref: ${ref}, text: ${q(s.text)}${s.enter ? ", enter: true" : ""} });`];
}

/** The lines that check the bug is gone, or null when the simulator test API cannot check this kind. */
function assertion(f: Finding): string[] | null {
  const shown = /the screen shows "(.*)"$/.exec(f.message)?.[1];
  switch (f.kind) {
    case "error": case "network_failed": return shown ? [`expect(phone).not.toSee(${q(shown)});`] : null;
    case "blank_screen": return [`expect(phone.screen.trim().length).toBeGreaterThan(0);`, `expect(phone.nodes().length).toBeGreaterThan(0);`];
    case "dead_end": return [`expect(phone.nodes().some((n) => ${ACTIONABLE}.includes(n.role))).toBe(true);`];
    case "unnamed": { const role = /^Unnamed (\S+):/.exec(f.message)?.[1]; return role ? [`expect(phone.nodes().filter((n) => n.role === ${q(role)} && !n.name)).toHaveLength(0);`] : null; }
    case "duplicate_name": {
      const m = /named "(.*)", so a screen reader/.exec(f.message); const role = /\d+ (\S+?)s are named/.exec(f.message)?.[1];
      return m && role ? [`expect(phone.nodes().filter((n) => n.role === ${q(role)} && n.name === ${q(m[1]!)}).length).toBeLessThan(2);`] : null;
    }
    case "stuck_loading": return [`await phone.waitForGone(/loading/i, { timeout: 5000 });`];
    case "not_delivered": case "action_failed": return []; // the last step itself throws while the bug exists
    default: return null; // small_target: the size is not on the screen text
  }
}

/** Source of one test file, or null when this finding cannot be exported. */
export function findingToTest(f: Finding, n = 1): string | null {
  const check = assertion(f);
  if (!check) return null;
  const name = `lumi finding ${n}: ${f.message}`;
  return [
    `// Written by shipvo explore --save-tests. Fails while this bug exists, passes once it is fixed.`,
    `// ${f.kind} on ${screenName(f.screen)}`,
    `// Steps: ${f.steps.map(describeStep).join("; ")}`,
    `import { test, expect } from "@shipvo/test/vitest";`, "",
    `test(${q(name)}, async ({ phone }) => {`,
    ...[...f.steps.flatMap(stepCode), ...check].map((l) => `  ${l}`),
    `});`, "",
  ].join("\n");
}

/** Writes `<n>-<kind>-<screen>.test.ts` per distinct finding. Returns the files and the kinds it could not export. */
export function writeTests(findings: Finding[], dir: string): { files: string[]; skipped: string[] } {
  const seen = new Set<string>(); const files: string[] = []; const skipped: string[] = [];
  for (const f of findings) {
    const k = `${f.kind}|${f.message}|${signature(f.screen)}`; if (seen.has(k)) continue; seen.add(k);
    const src = findingToTest(f, files.length + 1);
    if (!src) { skipped.push(f.message); continue; }
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${files.length + 1}-${f.kind}-${slug(screenName(f.screen))}.test.ts`);
    writeFileSync(file, src); files.push(file);
  }
  return { files, skipped };
}
