import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_INPUT_ARRAY, MAX_INPUT_STRING, tools } from "../src/index.js";

const parse = (name: keyof typeof tools, input: unknown) => z.object(tools[name].input).safeParse(input);

describe("tool input size caps", () => {
  it("accepts a string and an array at the limit", () => {
    expect(parse("set_clipboard", { session: "s", text: "a".repeat(MAX_INPUT_STRING) }).success).toBe(true);
    expect(parse("register_wakeup", { session: "s", name: "n", url: "https://x.test", events: Array(2).fill("task") }).success).toBe(true);
  });

  it("rejects an oversized string", () => {
    expect(parse("set_clipboard", { session: "s", text: "a".repeat(MAX_INPUT_STRING + 1) }).success).toBe(false);
  });

  it("rejects an oversized array", () => {
    const lines = Array.from({ length: MAX_INPUT_ARRAY + 1 }, () => ({ product_id: "p", quantity: 1 }));
    expect(parse("open_app", { app: "tide", seed_cart: lines }).success).toBe(false);
  });

  it("every string and array in every tool schema has a maximum", () => {
    const walk = (n: unknown, path: string): string[] => {
      if (!n || typeof n !== "object") return [];
      const o = n as Record<string, unknown>;
      const bad: string[] = [];
      if (o.type === "string" && o.maxLength === undefined && o.enum === undefined && o.const === undefined) bad.push(path);
      if (o.type === "array" && o.maxItems === undefined) bad.push(path);
      for (const [k, v] of Object.entries(o)) bad.push(...walk(v, `${path}.${k}`));
      return bad;
    };
    const missing = Object.values(tools).flatMap((t) => walk(z.toJSONSchema(z.object(t.input), { target: "draft-7", io: "input" }), t.name));
    expect(missing).toEqual([]);
  });
});
