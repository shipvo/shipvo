import { describe, it, expect } from "vitest";
import { RECORDER_JS } from "../src/preview-recorder";
import { framePage } from "../src/preview";
import { exportTest, type Step } from "../../mcp/src/export";

const page = new Function(`${RECORDER_JS}; return { exp: shipvoExport, steps: shipvoSteps };`)() as { exp: (app: string, s: unknown[]) => string; steps: unknown[] };
const t = (text: string, matches = 1) => ({ text, role: "button", matches });

const session: Step[] = [
  { action: "tap", target: t("Add to cart"), changed: true },
  { action: "type", fieldLabel: "Email", text: "a@b.c", target: { text: "Email", role: "textbox", matches: 1 } },
  { action: "type", fieldLabel: "Password", text: "hunter2", passwordLike: true, target: { text: "Password", role: "textbox", matches: 1 } },
  { action: "tap", target: t("OK", 2), changed: true },
  { action: "scroll", direction: "up" },
  { action: "back" },
];

describe("preview recorder", () => {
  it("writes the same script as the MCP export", () => {
    expect(page.exp("shop", session)).toBe(exportTest("shop", session));
  });
  it("keeps typed passwords out of the file", () => {
    const out = page.exp("shop", session);
    expect(out).not.toContain("hunter2");
    expect(out).toContain("process.env.SHIPVO_TEST_PASSWORD");
  });
  it("replays green against a phone that has the recorded screen", async () => {
    const script = page.exp("shop", session.filter((s) => !(s.action === "tap" && s.target!.matches > 1)));
    const body = script.split("\n").filter((l) => l.startsWith("  await phone.") || l.startsWith("  const phone")).join("\n").replace("const phone = await openApp({ app: \"shop\" });", "");
    const seen: string[] = [];
    const phone = {
      async tap(x: string) { if (x !== "Add to cart") throw new Error("no " + x); seen.push("tap " + x); },
      async type(l: string, v: string) { if (!["Email", "Password"].includes(l)) throw new Error("no " + l); seen.push(`type ${l}`); void v; },
      async scroll() { seen.push("scroll"); }, async back() { seen.push("back"); }, async waitFor() { seen.push("wait"); },
    };
    const process = { env: { SHIPVO_TEST_PASSWORD: "x" } };
    await new Function("phone", "process", `return (async () => {\n${body.replace(/!\)/g, ")")}\n})()`)(phone, process);
    expect(seen).toEqual(["tap Add to cart", "wait", "type Email", "type Password", "scroll", "back"]);
  });
  it("frame page has the recorder, download button and honesty line", () => {
    const h = framePage("Shop");
    expect(h).toContain('id="rec"');
    expect(h).toContain('id="dl"');
    expect(h).toContain("web build on Shipvo's simulated device");
    expect(h).toContain("docs/parity-results.md");
    expect(h).toContain("Native-only UI can differ");
  });
});
