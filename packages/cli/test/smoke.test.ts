import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { smoke, countElements } from "../src/smoke";
import type { Driver } from "../src/explore";

const tree = '- main:\n  - button "Go" [ref=e1]\n  - heading "Hi" [ref=e2]';
const ok = (screen: string | null) => ({ ok: true, screen });
function driver(o: { screen?: string; errors?: string[]; consoleErrors?: string[]; open?: Driver["open"] }): Driver {
  return {
    open: o.open ?? (async () => ok(o.screen ?? tree)), openUrl: async () => ok(null), tap: async () => ok(null), back: async () => ok(null),
    errors: async () => o.errors ?? [], consoleErrors: async () => o.consoleErrors ?? [], screen: async () => o.screen ?? tree,
  };
}
async function run(argv: string[], d: Driver | null, start?: () => Promise<never>) {
  const dir = mkdtempSync(join(tmpdir(), "shipvo-smoke-"));
  writeFileSync(join(dir, "shipvo.json"), JSON.stringify({ appId: "demo", controlPlane: "http://x", publicKey: "k" }));
  const prev = process.cwd(); process.chdir(dir);
  const lines: string[] = [];
  try {
    const code = await smoke(argv, { start: start ?? (async () => ({ base: "http://sim", stop: () => {} })), driver: () => d!, sleep: async () => {}, log: (l) => lines.push(l) });
    return { code, lines };
  } finally { process.chdir(prev); }
}

describe("shipvo smoke", () => {
  it("counts elements by ref", () => expect(countElements(tree)).toBe(2));

  it("passes on a healthy app and prints the JSON envelope", async () => {
    const { code, lines } = await run(["--json"], driver({}));
    const j = JSON.parse(lines[0]!);
    expect(code).toBe(0);
    expect(j).toMatchObject({ ok: true, code: "ok", data: { platform: "android", elements: 2, errors: [], error_count: 0 } });
    expect(typeof j.data.time_to_first_screen_ms).toBe("number");
    expect(Array.isArray(j.next)).toBe(true);
  });

  it("takes ios as the platform", async () => {
    const { code, lines } = await run(["ios", "--json", "--timeout", "5"], driver({}));
    expect(code).toBe(0);
    expect(JSON.parse(lines[0]!).data.platform).toBe("ios");
  });

  it("exits 1 with the error text when the app throws on load", async () => {
    const { code, lines } = await run(["--json"], driver({ errors: ["boom on load"], consoleErrors: ["Warning: bad"] }));
    const j = JSON.parse(lines[0]!);
    expect(code).toBe(1);
    expect(j.ok).toBe(false); expect(j.code).toBe("load_failed");
    expect(j.data.errors).toEqual(["Uncaught error: boom on load", "console.error: Warning: bad"]);
  });

  it("keeps only the first 5 errors but counts all", async () => {
    const { lines } = await run(["--json"], driver({ errors: Array.from({ length: 8 }, (_, i) => `e${i}`) }));
    const j = JSON.parse(lines[0]!);
    expect(j.data.errors).toHaveLength(5); expect(j.data.error_count).toBe(8);
  });

  it("fails when the first screen has no elements", async () => {
    const { code, lines } = await run(["--json"], driver({ screen: "- main:" }));
    expect(code).toBe(1);
    expect(JSON.parse(lines[0]!).data.errors[0]).toMatch(/no elements/);
  });

  it("fails when the app does not open before the timeout", async () => {
    const { code, lines } = await run(["--json", "--timeout", "1"], driver({ open: () => new Promise(() => {}) }));
    expect(code).toBe(1);
    expect(JSON.parse(lines[0]!).data.errors[0]).toMatch(/within 1 s/);
  });

  it("exits 2 with an install command when the browser is missing", async () => {
    const { code, lines } = await run(["--json"], null, async () => { throw new Error("playwright is not installed and SHIPVO_NO_AUTO_INSTALL=1 is set."); });
    const j = JSON.parse(lines[0]!);
    expect(code).toBe(2);
    expect(j.code).toBe("setup_error");
    expect(j.next[0].command).toMatch(/playwright/);
  });

  it("exits 2 on an unknown platform and on a bad timeout", async () => {
    expect((await run(["windows", "--json"], driver({}))).code).toBe(2);
    expect((await run(["--timeout", "0", "--json"], driver({}))).code).toBe(2);
  });

  it("prints a short text result without --json", async () => {
    const { code, lines } = await run([], driver({ errors: ["x"] }));
    expect(code).toBe(1);
    expect(lines.join("\n")).toMatch(/FAIL[\s\S]*platform: android[\s\S]*error: Uncaught error: x/);
  });
});
