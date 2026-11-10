import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toolsFromSpec } from "../src/index.js";

const spec = JSON.parse(readFileSync(new URL("./fixtures/stripe-tracker.json", import.meta.url), "utf8"));

describe("toolsFromSpec", () => {
  it("yields one tool with a valid JSON schema per action", () => {
    const tools = toolsFromSpec(spec);
    expect(tools.map((t) => t.name)).toEqual(["add_goal", "stripe_summary"]);
    const add = tools[0]!;
    expect(add.inputSchema).toEqual({
      type: "object",
      properties: {
        due: { type: "string", format: "date" },
        target: { type: "number" },
        title: { type: "string" },
      },
      additionalProperties: false,
      required: ["due", "target", "title"],
    });
    const sum = tools[1]!;
    expect(sum.inputSchema.required).toBeUndefined();
    expect((sum.inputSchema.properties as any).period).toEqual({ type: "string", enum: ["day", "week", "month"], default: "day" });
    expect(sum.description).toBe("Revenue, new customers and failed payments for a period.");
    expect(sum.errors.map((e) => e.code)).toEqual(["invalid_input", "permission_denied", "action_failed"]);
  });

  it("resolves collisions with reserved names deterministically", () => {
    const a = toolsFromSpec(spec, { reserved: ["add_goal", "app_add_goal"] });
    expect(a.map((t) => t.name)).toEqual(["app_add_goal_2", "stripe_summary"]);
    expect(a[0]!.action).toBe("add_goal");
    expect(toolsFromSpec(spec, { reserved: ["app_add_goal", "add_goal"] })).toEqual(a);
  });

  it("is sorted and identical across runs", () => {
    const shuffled = { ...spec, actions: { z: { do: [{ toast: "z" }] }, b: { effect: "external", do: [{ toast: "b" }] }, a: { do: [{ toast: "a" }] } } };
    const first = JSON.stringify(toolsFromSpec(shuffled));
    expect(JSON.stringify(toolsFromSpec(shuffled))).toBe(first);
    const tools = toolsFromSpec(shuffled);
    expect(tools.map((t) => t.name)).toEqual(["a", "b", "z"]);
    expect(tools[1]!.needsApproval).toBe(true);
    expect(tools[0]!.description).toBe("Run the a action.");
  });
});
