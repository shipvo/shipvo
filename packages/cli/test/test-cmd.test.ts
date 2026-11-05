import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testCmd, type TestKit } from "../src/test";

const cwd = process.cwd();
afterEach(() => process.chdir(cwd));

const SCREEN = '- button "Add to basket" [ref=e1]\n- link "Home" [ref=e2]';
const SRC = '# cart\ntap "Add to cart"\nsee "Cart"\n';
// A tiny fake of @shipvo/test: tap fails unless the target is on screen.
function kit(screen = SCREEN): TestKit {
  const phone = { screen };
  return {
    openApp: async () => phone,
    parseSteps: (t) => t.split("\n").flatMap((l, i) => {
      const m = /^tap "(.*)"$/.exec(l); const s = /^see "(.*)"$/.exec(l);
      return m ? [{ kind: "tap", target: m[1]!, line: i + 1 }] : s ? [{ kind: "see", text: s[1]!, line: i + 1 }] : [];
    }),
    runSteps: async (p, steps) => { for (const s of steps) if (s.kind === "tap" && !p.screen.includes(`"${s.target}"`)) throw new Error(`nothing on screen matches "${s.target}"`); },
    proposeRepair: (s) => s.target === "Add to cart"
      ? { kind: "repaired", step: { ...s, target: "Add to basket" }, reason: 'label "Add to cart" is now "Add to basket"' }
      : { kind: "unresolved", candidates: [] },
  };
}
function project() {
  const d = mkdtempSync(join(tmpdir(), "shipvo-test-"));
  const f = join(d, "cart.steps");
  writeFileSync(f, SRC);
  return f;
}

describe("shipvo test --repair", () => {
  it("prints a unified diff and leaves the file unchanged without --write", async () => {
    const f = project(); const out: string[] = [];
    const code = await testCmd([f, "--repair"], kit(), (s) => out.push(s));
    const text = out.join("\n");
    expect(text).toContain('-tap "Add to cart"');
    expect(text).toContain('+tap "Add to basket"');
    expect(readFileSync(f, "utf8")).toBe(SRC);
    expect(code).toBe(1);
  });
  it("--write changes only the broken line and keeps every step", async () => {
    const f = project();
    const code = await testCmd([f, "--repair", "--write"], kit(), () => {});
    expect(readFileSync(f, "utf8")).toBe('# cart\ntap "Add to basket"\nsee "Cart"\n');
    expect(code).toBe(0);
  });
  it("without --repair it only reports and writes nothing", async () => {
    const f = project();
    expect(await testCmd([f], kit(), () => {})).toBe(1);
    expect(readFileSync(f, "utf8")).toBe(SRC);
  });
  it("--write alone is refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await testCmd(["--write"], kit(), () => {})).toBe(2);
  });
});
