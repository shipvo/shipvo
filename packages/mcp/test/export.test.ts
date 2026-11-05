import { describe, expect, it } from "vitest";
import { exportTest, type Step } from "../src/export.js";

const t = (text: string, matches = 1) => ({ text, role: "button", matches });
const body = (s: Step[]) => exportTest("menu", s);

describe("exportTest", () => {
  it("handles an empty step list", () => {
    const out = body([]);
    expect(out).toContain('openApp({ app: "menu" })');
    expect(out).not.toContain("phone.tap");
  });
  it("open emits nothing extra", () => expect(body([{ action: "open" }])).toBe(body([])));
  it("tap", () => expect(body([{ action: "tap", target: t("Add to cart") }])).toContain('await phone.tap("Add to cart");'));
  it("type", () => expect(body([{ action: "type", fieldLabel: "Email", text: "a@b.c" }])).toContain('await phone.type("Email", "a@b.c");'));
  it("scroll", () => expect(body([{ action: "scroll", direction: "up" }])).toContain('await phone.scroll("up");'));
  it("back", () => expect(body([{ action: "back" }])).toContain("await phone.back();"));
  it("set_device", () => expect(body([{ action: "set_device", device: { dark: true } }])).toContain('await phone.device.set({"dark":true});'));
  it("waitFor after a changed step only", () => {
    const out = body([{ action: "tap", target: t("A"), changed: true }, { action: "tap", target: t("B"), changed: false }]);
    expect(out.match(/waitFor/g)).toHaveLength(1);
  });
  it("ambiguous target is a TODO, not a guess", () => {
    const out = body([{ action: "tap", target: t("OK", 2), changed: true }]);
    expect(out).toContain('// TODO: ambiguous target "OK"');
    expect(out).not.toContain("phone.tap");
    expect(out).not.toContain("waitFor");
  });
  it("password-like field uses an env var and never the value", () => {
    const out = body([{ action: "type", fieldLabel: "Pass word", text: "hunter2", passwordLike: true }]);
    expect(out).toContain("process.env.SHIPVO_TEST_PASS_WORD");
    expect(out).not.toContain("hunter2");
  });
  it("escapes quotes in text", () => expect(body([{ action: "tap", target: t('Say "hi"') }])).toContain('phone.tap("Say \\"hi\\"")'));
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  const onlyCodeOrComments = (out: string) => {
    const lines = out.split(/[\r\n\u2028\u2029]/).slice(5, -2).filter((l) => l.trim());
    for (const l of lines) expect(l.trim().startsWith("//") || /^await .*;( \/\/.*)?$/.test(l.trim())).toBe(true);
  };
  it("line separators in an ambiguous target stay inside the comment", () => {
    for (const sep of [LS, PS]) {
      const out = body([{ action: "tap", target: t(`x${sep}await evil();`, 2) }]);
      expect(out).not.toContain(sep);
      onlyCodeOrComments(out);
    }
  });
  it("line separators in tap text are escaped", () => {
    for (const sep of [LS, PS]) {
      const out = body([{ action: "tap", target: t(`x${sep}await evil();`) }]);
      expect(out).not.toContain(sep);
      expect(out).toContain("phone.tap(");
      onlyCodeOrComments(out);
    }
  });
  it("ambiguous type target without a field label is a TODO", () => {
    const out = body([{ action: "type", target: t("Email", 2), text: "x" }]);
    expect(out).toContain("// TODO: ambiguous target");
    expect(out).not.toContain("phone.type");
  });
  it("ambiguous target is a TODO even with a field label", () => {
    const out = body([{ action: "type", fieldLabel: "Email", target: t("Email", 2), text: "x" }]);
    expect(out).toContain("// TODO: ambiguous target");
    expect(out).not.toContain("phone.type");
  });
  it("type with no label and no target is a TODO with no value", () => {
    const out = body([{ action: "type", text: "secret-value" }]);
    expect(out).toContain("// TODO: type without a field label");
    expect(out).not.toContain("secret-value");
  });
  it("passwordLike with no label is a TODO with no value", () => {
    const out = body([{ action: "type", text: "hunter2", passwordLike: true }]);
    expect(out).toContain("// TODO");
    expect(out).not.toContain("hunter2");
  });
  it("sample script snapshot", () => {
    expect(body([
      { action: "open" },
      { action: "set_device", device: { dark: true } },
      { action: "tap", target: t("Sign in"), changed: true },
      { action: "type", fieldLabel: "Email", text: "me@example.com" },
      { action: "type", fieldLabel: "Password", text: "secret", passwordLike: true },
      { action: "tap", target: t("Continue", 3) },
      { action: "scroll", direction: "down" },
      { action: "back", changed: true },
    ])).toMatchSnapshot();
  });
});
