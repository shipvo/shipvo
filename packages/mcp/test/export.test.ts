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
  it("open emits nothing extra", () => expect(body([{ action: "open" }])).not.toContain("phone."+"tap"));
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
