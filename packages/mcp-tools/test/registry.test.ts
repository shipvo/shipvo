import { describe, expect, it } from "vitest";
import { describeTools, toolList, tools } from "../src/index.js";

describe("tool registry", () => {
  it("has unique names that match their keys", () => {
    const names = toolList.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const [key, t] of Object.entries(tools)) expect(t.name).toBe(key);
  });

  it("gives every tool a description, an object JSON Schema and snake_case error codes", () => {
    for (const t of describeTools()) {
      expect(t.description.length, t.name).toBeGreaterThan(10);
      expect(t.inputSchema.type, t.name).toBe("object");
      for (const c of t.errorCodes) expect(c, t.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  it("lists every code a description says the tool fails with", () => {
    for (const t of toolList) {
      for (const m of t.description.matchAll(/[Ff]ails with ([^.]*)/g))
        for (const c of m[1].matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g))
          if (!toolList.some((o) => o.name === c[1])) expect(t.errorCodes, t.name).toContain(c[1]);
    }
  });

  it("lets open_app pick android or ios, and nothing else", () => {
    const p = (describeTools().find((t) => t.name === "open_app")!.inputSchema as { properties: Record<string, { enum?: string[] }> }).properties.platform;
    expect(p.enum).toEqual(["android", "ios"]);
  });

  it("marks owner_command as needing an approval card", () => {
    expect(tools.owner_command.needsApproval).toBe(true);
    expect(toolList.filter((t) => t.needsApproval).map((t) => t.name)).toEqual(["owner_command"]);
  });

  it("lets set_device send payment.nextResult cancel", () => {
    const shape = tools.set_device.input as any;
    const ok = (v: string) => shape.payment.safeParse({ nextResult: v }).success;
    expect(ok("cancel")).toBe(true);
    expect(ok("approve")).toBe(true);
    expect(ok("nope")).toBe(false);
  });
});
