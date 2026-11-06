import { describe, expect, it } from "vitest";
import { walk, type ActionRecord, type Driver, type Reply } from "../src/explore.js";

// Labels that must never reach the output.
const SECRET_LABEL = "Zebra Quartz Account";
const SCREENS: Record<string, string> = {
  home: `- heading "Home" [ref=e1]\n- textbox "Email" [ref=e2]\n- button "${SECRET_LABEL}" [ref=e3]`,
  next: `- heading "Next" [ref=e1]\n- button "Back" [ref=e2]`,
};
function fixture(): Driver {
  let at = "home";
  const view = (): Reply => ({ ok: true, screen: SCREENS[at] });
  return {
    async open() { at = "home"; return view(); },
    async openUrl() { return view(); },
    async tap(ref) { if (at === "home" && ref === "e3") at = "next"; return view(); },
    async back() { at = "home"; return view(); },
    async type() { return view(); },
    async errors() { return []; },
  };
}
const run = async (record: boolean) => {
  const lines: ActionRecord[] = [];
  const report = await walk(fixture(), { seed: 3, settleMs: 0, app: "x", ...(record ? { onAction: (r: ActionRecord) => lines.push(r) } : {}) });
  return { lines, report: { ...report, generatedAt: "" } };
};

describe("walk onAction (--record-features)", () => {
  it("does not change the report", async () => {
    expect((await run(true)).report).toEqual((await run(false)).report);
  });
  it("writes one record per action that matches the documented schema", async () => {
    const { lines, report } = await run(true);
    expect(lines.length).toBe(report.steps);
    const hex = /^[0-9a-f]{16}$/;
    for (const l of lines) {
      expect(Object.keys(l).sort()).toEqual(["action", "n", "outcome", "screen", "seed", "v"]);
      expect(l.v).toBe(1);
      expect(Object.keys(l.screen).sort()).toEqual(["actions", "depth", "field_types", "hash", "roles", "tried"]);
      expect(l.screen.hash).toMatch(hex);
      expect(Object.keys(l.action).sort()).toEqual(["enter", "invalid_input", "kind", "label_hash", "nth", "risky", "role"]);
      expect(l.action.label_hash).toMatch(hex);
      expect(Object.keys(l.outcome).sort()).toEqual(["failed", "finding", "findings", "flow_finished", "new_screen", "screen_hash"]);
      expect(l.outcome.screen_hash).toMatch(hex);
    }
    expect(lines.some((l) => l.outcome.new_screen)).toBe(true);
    expect(lines.some((l) => l.action.kind === "type" && l.action.invalid_input)).toBe(true);
    expect(lines[0]!.screen.roles).toEqual({ button: 1 });
    expect(lines[0]!.screen.field_types).toEqual({ textbox: 1 });
  });
  it("never contains label text or typed values", async () => {
    const out = (await run(true)).lines.map((l) => JSON.stringify(l)).join("\n");
    for (const t of [SECRET_LABEL, "Zebra", "Email", "Home", "Next", "ada@example.com", "Ada Lovelace", "not-an-email", "hello"]) expect(out).not.toContain(t);
  });
});
