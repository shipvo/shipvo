import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffReports } from "../src/ci-compare";
import { renderComment, commentCmd } from "../src/ci-comment";

const P = (name: string) => ({ name, status: "passed" });
const F = (name: string, extra: object = {}) => ({ name, status: "failed", message: "boom", ...extra });
const base = { flows: [P("a"), F("b"), F("c"), P("d")] };
const pr = { flows: [F("a", { failedStep: { kind: "tap", target: "Pay" } }), P("b"), F("c"), P("d"), F("new")] };

describe("diffReports", () => {
  it("sorts flows", () => {
    const d = diffReports(base, pr)!;
    expect(d.regressions.map((f) => f.name)).toEqual(["a"]);
    expect(d.fixed.map((f) => f.name)).toEqual(["b"]);
    expect(d.stillFailing.map((f) => f.name)).toEqual(["c"]);
    expect(d.newFlows.map((f) => f.name)).toEqual(["new"]);
  });
  it("returns null without a base", () => { expect(diffReports(null, pr)).toBeNull(); });
});

describe("comment section", () => {
  it("lists regressions first with the failing step", () => {
    const c = renderComment({ test: pr, compare: diffReports(base, pr) });
    expect(c).toContain("### Compared with base");
    expect(c).toContain('- a (first failing step: tap "Pay". boom)');
    expect(c.indexOf("Regressions")).toBeLessThan(c.indexOf("Fixed"));
    expect(c.indexOf("Fixed")).toBeLessThan(c.indexOf("Still failing"));
  });
  it("omits the section with no comparison", () => {
    expect(renderComment({ test: pr, compare: diffReports(null, pr) })).not.toContain("Compared with base");
  });
});

describe("shipvo ci comment exit code", () => {
  afterEach(() => vi.restoreAllMocks());
  const run = (b: object | null, p: object, flags: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), "cmp-"));
    const bf = join(dir, "base.json"), pf = join(dir, "pr.json");
    if (b) writeFileSync(bf, JSON.stringify(b));
    writeFileSync(pf, JSON.stringify(p));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.GITHUB_TOKEN;
    return commentCmd(["--base-report", bf, "--report", pf, "--screenshots", join(dir, "none"), ...flags]).then((rc) => ({ rc, err }));
  };
  it("1 on a regression", async () => { expect((await run(base, pr, ["--fail-on-regression"])).rc).toBe(1); });
  it("0 without the flag", async () => { expect((await run(base, pr, [])).rc).toBe(0); });
  it("0 with only still-failing flows", async () => {
    expect((await run({ flows: [F("c")] }, { flows: [F("c")] }, ["--fail-on-regression"])).rc).toBe(0);
  });
  it("missing base file: no section, one line, exit 0", async () => {
    const { rc, err } = await run(null, pr, ["--fail-on-regression"]);
    expect(rc).toBe(0);
    expect(err.mock.calls.some((c) => String(c[0]).includes("No comparison with base"))).toBe(true);
  });
});
