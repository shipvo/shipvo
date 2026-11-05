import { describe, it, expect, afterEach } from "vitest";
import { secret, redact, parseSteps, runSteps, PhoneError } from "../src/index.js";
import { Phone } from "../src/index.js";

afterEach(() => { delete process.env.SHIPVO_TEST_PASSWORD; });

describe("secret", () => {
  it("reads SHIPVO_TEST_<NAME>", () => {
    process.env.SHIPVO_TEST_PASSWORD = "hunter2-value";
    expect(secret("PASSWORD")).toBe("hunter2-value");
  });
  it("names the variable when it is missing", () => {
    expect(() => secret("PASSWORD")).toThrow(/SHIPVO_TEST_PASSWORD/);
    expect(() => secret("PASSWORD")).toThrow(/Set the environment variable/);
  });
  it("masks the value in redact()", () => {
    process.env.SHIPVO_TEST_PASSWORD = "s3cr3t-zz";
    secret("PASSWORD");
    expect(redact("bad s3cr3t-zz here")).toBe("bad *** here");
  });
});

describe("{secret:NAME} steps", () => {
  const make = (fail = false) => {
    const typed: string[] = [];
    const phone = {
      screen: "textbox Password: s3cr3t-zz",
      type: async (_t: string, x: string) => { typed.push(x); if (fail) throw new Error(`rejected ${x}`); },
    } as unknown as Phone;
    return { phone, typed };
  };
  it("keeps the placeholder in the parsed step and resolves it at run time", async () => {
    process.env.SHIPVO_TEST_PASSWORD = "s3cr3t-zz";
    const steps = parseSteps('type "{secret:PASSWORD}" into "Password"');
    expect(JSON.stringify(steps)).toContain("{secret:PASSWORD}");
    expect(JSON.stringify(steps)).not.toContain("s3cr3t-zz");
    const { phone, typed } = make();
    await runSteps(phone, steps);
    expect(typed).toEqual(["s3cr3t-zz"]);
  });
  it("never puts the value in an error", async () => {
    process.env.SHIPVO_TEST_PASSWORD = "s3cr3t-zz";
    const { phone } = make(true);
    const err = await runSteps(phone, parseSteps('type "{secret:PASSWORD}" into "Password"')).catch((e) => e as PhoneError) as PhoneError;
    expect(err.message).toContain("***");
    expect(err.message).not.toContain("s3cr3t-zz");
  });
  it("fails with the variable name when unset", async () => {
    const { phone, typed } = make();
    await expect(runSteps(phone, parseSteps('type "{secret:PASSWORD}" into "Password"'))).rejects.toThrow(/line 1.*SHIPVO_TEST_PASSWORD/s);
    expect(typed).toEqual([]);
  });
});

describe("Phone errors", () => {
  const phoneShowing = (screen: string) => {
    const phone = new Phone("s1", "http://sim.invalid", "app", "latest");
    phone.screen = screen;
    phone.call = async () => ({ ok: true, screen });
    return phone;
  };
  const SCREEN = '- textbox "Password" [ref=e1]\n- text "oops s3cr3t-zz" [ref=e2]';
  it("masks the secret in locate, waitFor and waitForGone errors", async () => {
    process.env.SHIPVO_TEST_PASSWORD = "s3cr3t-zz";
    secret("PASSWORD");
    const phone = phoneShowing(SCREEN);
    expect(() => phone.locate("Nope")).toThrow(/\*\*\*/);
    try { phone.locate("Nope"); } catch (e) { expect((e as Error).message).not.toContain("s3cr3t-zz"); }
    const w = await phone.waitFor("never here", { timeout: 1, interval: 1 }).catch((e) => e as Error) as Error;
    expect(w.message).toContain("***");
    expect(w.message).not.toContain("s3cr3t-zz");
    const g = await phone.waitForGone("oops", { timeout: 1, interval: 1 }).catch((e) => e as Error) as Error;
    expect(g.message).toContain("***");
    expect(g.message).not.toContain("s3cr3t-zz");
  });
  it("does not mask values shorter than 4 characters", () => {
    process.env.SHIPVO_TEST_PASSWORD = "12";
    secret("PASSWORD");
    expect(redact("code 12")).toBe("code 12");
  });
});
