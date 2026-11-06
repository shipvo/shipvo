import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findingToIssue, redactTestSecrets, writeIssues } from "../src/explore-issues.js";
import { PARITY_LIMITS, type Finding, type Kind } from "../src/explore.js";

const kinds: Kind[] = ["error", "not_delivered", "action_failed", "dead_end", "unnamed", "small_target", "duplicate_name"];
const mk = (kind: Kind, message = `msg ${kind}`): Finding => ({
  kind, message, screen: '- heading "Cart" [ref=e1]\n- button "Pay" [ref=e2]',
  steps: [{ action: "open" }, { action: "tap", role: "button", name: "Pay", nth: 1 }, { action: "back" }],
});

describe("findingToIssue", () => {
  for (const k of kinds) it(`renders ${k}`, () => {
    const { title, body } = findingToIssue(mk(k), "android");
    expect(title).toBe(`explore: ${k} on Cart`);
    expect(body).toContain(`msg ${k}`);
    expect(body).toContain("Platform skin: android");
    for (const p of PARITY_LIMITS) expect(body).toContain(p);
  });
  it("numbers the steps", () => {
    const { body } = findingToIssue(mk("error"), "ios");
    expect(body).toContain('1. open the app\n2. tap button "Pay" (number 2 with that name)\n3. back');
    expect(body).toContain("Platform skin: ios");
  });
});

describe("writeIssues", () => {
  it("writes one file per distinct finding", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "iss-")), "out");
    const r = writeIssues([mk("error"), mk("error"), mk("dead_end")], "android", dir);
    expect(readdirSync(dir).sort()).toEqual(["1-error.md", "2-dead_end.md"]);
    expect(readFileSync(r.files[0]!, "utf8").split("\n")[0]).toBe("explore: error on Cart");
    expect(r.commands[0]).toBe(`gh issue create --title 'explore: error on Cart' --body-file '${r.files[0]}'`);
  });
  it("writes nothing without findings", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "iss-")), "out");
    expect(writeIssues([], "android", dir).files).toEqual([]);
    expect(() => readdirSync(dir)).toThrow();
  });
});

describe("test account secrets", () => {
  it("writes no account value into issue files", () => {
    process.env.SHIPVO_TEST_ACCOUNT_BUYER_PASSWORD = "pw-Zx81-secret";
    try {
      const dir = mkdtempSync(join(tmpdir(), "issues-"));
      const f = mk("error", "Uncaught error: login rejected pw-Zx81-secret");
      f.steps = [{ action: "open" }, { action: "type", role: "textbox", name: "Password", text: "pw-Zx81-secret" }];
      f.screen += '\n- textbox "Password": pw-Zx81-secret';
      const { files } = writeIssues([f], "android", dir);
      const text = readFileSync(files[0]!, "utf8");
      expect(text).not.toContain("pw-Zx81-secret");
      expect(text).toContain("***");
    } finally { delete process.env.SHIPVO_TEST_ACCOUNT_BUYER_PASSWORD; }
  });
  it("masks a password with a quote or backslash in JSON output", () => {
    const pw = 'pw"Zx\\81-secret';
    const env = { SHIPVO_TEST_ACCOUNT_BUYER_PASSWORD: pw };
    const json = JSON.stringify({ message: `rejected ${pw}` });
    expect(json).not.toContain(pw);
    const out = redactTestSecrets(json, env);
    expect(out).not.toContain("Zx");
    expect(out).toContain("***");
    expect(redactTestSecrets(`plain ${pw}`, env)).toBe("plain ***");
  });
});
