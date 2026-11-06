import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testCmd, stepLine, type TestKit } from "../src/test";
import { parseSteps } from "../../test/src/steps";

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
  it("leaves the file alone when the repaired label has a double quote", async () => {
    const f = project(); const out: string[] = [];
    const k = kit();
    k.proposeRepair = (s) => ({ kind: "repaired", step: { ...s, target: 'Say "hi"' }, reason: "x" });
    k.runSteps = async () => { if (!out.length) { out.push("first"); throw new Error("fail"); } };
    const code = await testCmd([f, "--repair", "--write"], k, (s) => out.push(s));
    expect(readFileSync(f, "utf8")).toBe(SRC);
    expect(out.join("\n")).toContain("nothing changed");
    expect(code).toBe(1);
  });
  it("stepLine output is read back by the real parseSteps", () => {
    const lines = ['tap "Add to basket"', 'type "popper" into "Search"', 'type "popper" into "Search" and press enter'];
    for (const l of lines) {
      const [step] = parseSteps(l);
      expect(stepLine(step as never)).toBe(l);
      expect(parseSteps(stepLine(step as never))[0]).toEqual(step);
    }
    expect(() => stepLine({ kind: "tap", target: 'Say "hi"', line: 1 })).toThrow();
  });
});

describe("shipvo test --report", () => {
  const rep = (f: string) => JSON.parse(readFileSync(f, "utf8"));
  it("writes a passing run, with null commit and release when unknown", async () => {
    const f = project(); const out = join(tmpdir(), `rep-${Date.now()}.json`);
    const d = mkdtempSync(join(tmpdir(), "norepo-")); process.chdir(d);
    const sha = process.env.GITHUB_SHA; delete process.env.GITHUB_SHA;
    try {
      const code = await testCmd([f, "--report", out], kit('- button "Add to cart" [ref=e1]'), () => {});
      expect(code).toBe(0);
      const r = rep(out);
      expect(r.commit).toBeNull(); expect(r.release).toBeNull(); expect(r.app).toBeNull();
      expect(r.flows).toHaveLength(1);
      expect(r.flows[0]).toMatchObject({ name: f, status: "passed", failedStep: null, message: null });
      expect(r.flows[0].steps).toHaveLength(2);
      expect(r.parityLimits.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(r.time))).toBe(false);
    } finally { if (sha) process.env.GITHUB_SHA = sha; }
  });
  it("writes a failing run with the failing step; exit code stays 1", async () => {
    const f = project(); const out = join(tmpdir(), `rep-${Date.now()}b.json`);
    process.env.GITHUB_SHA = "abc123";
    try {
      const code = await testCmd([f, "--report", out, "--release", "7"], kit(), () => {});
      expect(code).toBe(1);
      const r = rep(out);
      expect(r.commit).toBe("abc123"); expect(r.release).toBe("7");
      expect(r.flows[0]).toMatchObject({ status: "failed", failedStep: { kind: "tap", target: "Add to cart", line: 2 } });
      expect(r.flows[0].message).toContain("Add to cart");
    } finally { delete process.env.GITHUB_SHA; }
  });
});

describe("secrets in reports", () => {
  it("keeps the placeholder and masks values in the report", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shipvo-secret-"));
    const f = join(dir, "login.steps"), out = join(dir, "r.json");
    writeFileSync(f, 'type "{secret:PASSWORD}" into "Password"\n');
    const base = kit();
    const k: TestKit = {
      ...base,
      parseSteps: () => [{ kind: "type", target: "Password", text: "{secret:PASSWORD}", enter: false, line: 1 }],
      runSteps: async () => { throw new Error("rejected hunter2-value"); },
      redact: (t) => t.split("hunter2-value").join("***"),
    };
    expect(await testCmd([f, "--report", out], k, () => {})).toBe(1);
    const text = readFileSync(out, "utf8");
    expect(text).toContain("{secret:PASSWORD}");
    expect(text).toContain("rejected ***");
    expect(text).not.toContain("hunter2-value");
  });
});

describe("secrets in logs", () => {
  it("never logs a secret that the screen or an error shows, even in repair candidates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shipvo-secret-"));
    const f = join(dir, "login.steps");
    writeFileSync(f, 'tap "Sign in"\n');
    const k: TestKit = {
      openApp: async () => ({ screen: '- textbox "hunter2-value" [ref=e1]' }),
      parseSteps: () => [{ kind: "tap", target: "Sign in", line: 1 }],
      runSteps: async () => { throw new Error("bad hunter2-value\n\nScreen now:\nhunter2-value"); },
      redact: (t) => t.split("hunter2-value").join("***"),
      proposeRepair: () => ({ kind: "unresolved", candidates: [{ role: "textbox", name: "hunter2-value", text: "", ref: "e1" } as never] }),
    };
    const out: string[] = [];
    await testCmd([f, "--repair"], k, (s) => out.push(s));
    const text = out.join("\n");
    expect(text).toContain("candidates:");
    expect(text).toContain("***");
    expect(text).not.toContain("hunter2-value");
  });
});

describe("shipvo test --json", () => {
  it("prints one envelope on stdout and exits 1 when a flow fails", async () => {
    const f = project(); const logs: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a) => { logs.push(a.join(" ")); });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await testCmd([f, "--json"], kit());
    log.mockRestore();
    expect(code).toBe(1);
    expect(logs).toHaveLength(1);
    const doc = JSON.parse(logs[0]!);
    expect(doc).toMatchObject({ ok: false, code: "tests_failed" });
    expect(doc.data.flows[0].status).toBe("failed");
    expect(doc.next.length).toBeGreaterThan(0);
    expect(err.mock.calls.flat().join("\n")).toContain("FAIL");
    err.mockRestore();
  });
  it("exits 0 with ok when every step passes", async () => {
    const f = project(); const logs: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a) => { logs.push(a.join(" ")); });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await testCmd([f, "--json"], kit('- button "Add to cart" [ref=e1]\n- text "Cart" [ref=e2]'));
    log.mockRestore(); err.mockRestore();
    expect(code).toBe(0);
    expect(JSON.parse(logs[0]!)).toMatchObject({ ok: true, code: "ok" });
  });
  it("exits 2 with an envelope on a usage error", async () => {
    const logs: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a) => { logs.push(a.join(" ")); });
    const code = await testCmd(["--json", "--write"], kit());
    log.mockRestore();
    expect(code).toBe(2);
    expect(JSON.parse(logs[0]!)).toMatchObject({ ok: false, code: "usage" });
  });
});

describe("shipvo test --json errors", () => {
  it("emits an error envelope and exits 2 when a steps file is missing", async () => {
    const out: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
    try {
      const code = await testCmd([join(tmpdir(), "shipvo-no-such-file.steps"), "--json"], kit(), () => {});
      expect(code).toBe(2);
      expect(out).toHaveLength(1);
      const doc = JSON.parse(out[0]!);
      expect(doc.ok).toBe(false);
      expect(doc.code).toBe("error");
      expect(doc.next.length).toBeGreaterThanOrEqual(1);
    } finally { spy.mockRestore(); }
  });
  it("still throws without --json", async () => {
    await expect(testCmd([join(tmpdir(), "shipvo-no-such-file.steps")], kit(), () => {})).rejects.toThrow();
  });
});
