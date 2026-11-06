// Finding -> `@shipvo/test` file. The test replays the steps, then asserts the bug is gone, so it fails while the bug exists. Pure: tests need no simulator.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ACTIONABLE, LOADING_RE, describeStep, signature, type Finding, type Step } from "./explore.js";
import { screenName } from "./explore-issues.js";

const q = (s: string) => JSON.stringify(s);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "screen";
// Same indicator test as `loading()` in explore.ts, so the test checks what the explorer saw.

function stepCode(s: Step): string[] {
  if (s.action === "open") return [];
  if (s.action === "open_url") return [`await phone.openUrl(${q(s.url)});`];
  if (s.action === "back") return ["await phone.back();"];
  const ref = `ref(${q(s.role)}, ${q(s.name)}, ${s.nth})`;
  return s.action === "tap"
    ? [`await phone.tap({ ref: ${ref} });`]
    : [`await phone.act("type", { ref: ${ref}, text: ${q(s.text)}${s.enter ? ", enter: true" : ""} });`];
}

// Finds the element a step used. A missing element fails with a clear message instead of acting on an empty ref.
const REF_HELPER = [
  "const ref = (role, name, nth) => {",
  "  const n = phone.nodes().filter((x) => x.role === role && x.name === name)[nth];",
  "  if (!n) throw new Error(`element not found: ${role} \"${name}\" (number ${nth + 1}) is not on the screen`);",
  "  return n.ref;",
  "};",
];

type Check = { lines: string[] } | { reason: string };

/** The lines that check the bug is gone, or the reason the simulator test API cannot check this kind. */
function assertion(f: Finding): Check {
  const shown = /the screen shows "(.*)"$/.exec(f.message)?.[1];
  switch (f.kind) {
    case "error": case "network_failed":
      return shown ? { lines: [`expect(phone).not.toSee(${q(shown)});`] }
        : { reason: f.kind === "error" ? "an uncaught page error is not on the screen, so a test cannot see it" : "a failed network call is not on the screen, so a test cannot see it" };
    case "blank_screen": return { lines: [`expect(phone.screen.trim().length).toBeGreaterThan(0);`, `expect(phone.nodes().length).toBeGreaterThan(0);`] };
    case "dead_end": return { lines: [`expect(phone.nodes().some((n) => ${JSON.stringify([...ACTIONABLE])}.includes(n.role))).toBe(true);`] };
    case "unnamed": { const role = /^Unnamed (\S+):/.exec(f.message)?.[1]; return role ? { lines: [`expect(phone.nodes().filter((n) => n.role === ${q(role)} && !n.name)).toHaveLength(0);`] } : { reason: "the role is not in the message" }; }
    case "duplicate_name": {
      const m = /named "(.*)", so a screen reader/.exec(f.message); const role = /\d+ (\S+?)s are named/.exec(f.message)?.[1];
      return m && role ? { lines: [`expect(phone.nodes().filter((n) => n.role === ${q(role)} && n.name === ${q(m[1]!)}).length).toBeLessThan(2);`] } : { reason: "the name is not in the message" };
    }
    case "stuck_loading": return { lines: [`await phone.waitForGone(${LOADING_RE.toString()}, { timeout: 5000 });`] };
    case "not_delivered": case "action_failed": return { reason: "the app did not take the action, and no state on the screen shows it" };
    default: return { reason: "a size check: the size is not on the screen text" };
  }
}

/** Source of one test file, or the reason this finding cannot be exported. */
export function exportTest(f: Finding, n = 1): { source: string } | { reason: string } {
  const check = assertion(f);
  if (!("lines" in check)) return check;
  const name = `lumi finding ${n}: ${f.message}`;
  const steps = f.steps.flatMap(stepCode);
  const body = [...(steps.some((l) => l.includes("ref(")) ? REF_HELPER : []), ...steps, ...check.lines];
  return { source: [
    `// Written by shipvo explore --save-tests. Fails while this bug exists, passes once it is fixed.`,
    `// ${f.kind} on ${screenName(f.screen)}`,
    `// Steps: ${f.steps.map(describeStep).join("; ")}`,
    `import { test, expect } from "@shipvo/test/vitest";`, "",
    `test(${q(name)}, async ({ phone }) => {`,
    ...body.map((l) => `  ${l}`),
    `});`, "",
  ].join("\n") };
}

/** Source of one test file, or null when this finding cannot be exported. */
export function findingToTest(f: Finding, n = 1): string | null {
  const r = exportTest(f, n);
  return "source" in r ? r.source : null;
}

/** Writes `<n>-<kind>-<screen>.test.ts` per distinct finding. Returns the absolute paths and each finding it could not export, with the reason. */
export function writeTests(findings: Finding[], dir: string): { files: string[]; skipped: { message: string; reason: string }[] } {
  const seen = new Set<string>(); const files: string[] = []; const skipped: { message: string; reason: string }[] = [];
  for (const f of findings) {
    const k = `${f.kind}|${f.message}|${signature(f.screen)}`; if (seen.has(k)) continue; seen.add(k);
    const r = exportTest(f, files.length + 1);
    if (!("source" in r)) { skipped.push({ message: f.message, reason: r.reason }); continue; }
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `${files.length + 1}-${f.kind}-${slug(screenName(f.screen))}.test.ts`);
    writeFileSync(file, r.source); files.push(file);
  }
  return { files, skipped };
}
