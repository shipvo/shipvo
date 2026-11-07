import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validate, appSpecSchema, celSyntaxError } from "../src/index";

const base = () => JSON.parse(readFileSync(new URL("./fixtures/stripe-tracker.json", import.meta.url), "utf8"));
const mini = (body: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  spec: "shipvo.app/v0",
  app: { id: "mini", name: "Mini" },
  screens: [{ id: "home", body }],
  ...extra
});
const paths = (xs: { path: string }[]) => xs.map((x) => x.path);

describe("example", () => {
  it("the Stripe tracker validates clean", () => {
    const r = validate(base());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
  it("the exported schema file matches the schema in use", () => {
    const file = JSON.parse(readFileSync(new URL("../src/app-spec.v0.schema.json", import.meta.url), "utf8"));
    expect(file).toEqual(appSpecSchema);
  });
});

describe("errors", () => {
  it("rejects a non-object", () => {
    expect(validate(null).errors[0]!.path).toBe("$");
    expect(validate([]).errors).toHaveLength(1);
  });
  it("schema: missing required keys and unknown keys with a hint", () => {
    const r = validate({ spec: "shipvo.app/v0", app: { id: "x1", name: "X" }, screenz: [] });
    expect(paths(r.errors)).toContain("$.screens");
    const typo = r.errors.find((e) => e.path === "$.screenz")!;
    expect(typo.fix).toContain("screens");
  });
  it("schema: wrong spec version", () => {
    expect(validate(mini([], { spec: "shipvo.app/v1" })).errors.map((e) => e.path)).toContain("$.spec");
  });
  it("schema: a source needs its fields", () => {
    const r = validate(mini([], { data: { x: { source: "http" } } }));
    expect(paths(r.errors)).toContain("$.data.x.get");
  });
  it("http to an undeclared domain", () => {
    const s = base();
    s.permissions.network = [];
    const r = validate(s);
    expect(r.errors.find((e) => e.path === "$.data.charges.get")!.fix).toContain("permissions.network");
  });
  it("http action step to a domain not in write", () => {
    const s = base();
    s.actions.add_goal.do.push({ http: { url: "https://hooks.example.com/x" } });
    const r = validate(s);
    expect(r.errors.some((e) => e.message.includes("permissions.write"))).toBe(true);
    s.permissions.write = ["hooks.example.com"];
    expect(validate(s).errors).toEqual([]);
  });
  it("data URLs whose host cannot be checked are errors", () => {
    for (const get of ["https://{{evil}}/x", "//evil.com/x", "https://evil.com\\@api.example.com/", "http://evil.com/x"]) {
      const r = validate(mini([], { permissions: { network: ["api.example.com"] }, data: { x: { source: "http", get } } }));
      expect(paths(r.errors), get).toContain("$.data.x.get");
    }
  });
  it("action step URLs whose host cannot be checked are errors", () => {
    const step = (http: unknown) => mini([], { permissions: { write: ["api.example.com"] }, actions: { go: { description: "d", do: [{ http }] } } });
    for (const url of ["//evil.com/x", "https://{{x}}/x", "http://evil.com/x", "https://evil.com\\@api.example.com/"]) {
      expect(paths(validate(step({ url })).errors), url).toContain("$.actions.go.do[0].http.url");
    }
    expect(validate(step({ url: "https://api.example.com/{{ input.id }}" })).errors).toEqual([]);
  });
  it("a step error names the key that held the URL", () => {
    const r = validate(mini([], { actions: { go: { description: "d", do: [{ http: { post: "https://evil.com/x" } }] } } }));
    expect(paths(r.errors)).toContain("$.actions.go.do[0].http.post");
  });
  it("expression with too many steps", () => {
    const r = validate(mini([{ type: "text", label: "t", when: Array(300).fill("1").join(" + ") }]));
    expect(r.errors.some((e) => e.message.includes("steps"))).toBe(true);
  });
  it("only children count as blocks", () => {
    const r = validate(mini([{ type: "table", columns: [{ type: "text" }] }]));
    expect(r.errors).toEqual([]);
  });
  it("the schema resolves from dist", async () => {
    const { createRequire } = await import("node:module");
    const file = createRequire(import.meta.url).resolve("@shipvo/spec/schema.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(appSpecSchema);
  });
  it("secret-looking strings", () => {
    for (const v of ["sk_live_" + "a1B2c3D4e5F6g7H8", "ghp_" + "a".repeat(30), "eyJhbGciOi.eyJzdWIiOiIx.abcdefghij", "Bearer abcdefghijklmnopqrstuvwx", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6"]) {
      const s = base();
      s.data.charges.query.token = v;
      const r = validate(s);
      expect(r.errors.some((e) => e.message.includes("secret")), v).toBe(true);
    }
  });
  it("interactive block without a label", () => {
    const r = validate(mini([{ type: "button" }]));
    expect(r.errors).toEqual([expect.objectContaining({ path: "$.screens[0].body[0]" })]);
  });
  it("contrast under AA", () => {
    const s = base();
    s.theme.palette.text = "#2A3340";
    const r = validate(s);
    expect(r.errors.some((e) => e.path === "$.theme.palette.text" && e.message.includes(":1"))).toBe(true);
  });
  it("expression syntax errors", () => {
    const r = validate(mini([{ type: "text", value: "{{ 1 + }}" }]));
    expect(paths(r.errors)).toEqual(["$.screens[0].body[0].value"]);
    expect(validate(mini([{ type: "text", value: "{{ oops" }])).errors).toHaveLength(1);
    expect(validate(mini([{ type: "text", when: "a &&", value: "x" }])).errors[0]!.path).toBe("$.screens[0].body[0].when");
  });
  it("expression longer than 2000 characters", () => {
    const r = validate(mini([{ type: "text", value: "{{ " + "1 + ".repeat(600) + "1 }}" }]));
    expect(r.errors.some((e) => e.message.includes("limit is 2000"))).toBe(true);
  });
  it("more than 40 screens", () => {
    const s = mini();
    s.screens = Array.from({ length: 41 }, (_, i) => ({ id: `s${i}`, body: [] }));
    expect(validate(s).errors.some((e) => e.path === "$.screens" && e.message.includes("limit is 40"))).toBe(true);
  });
  it("more than 2000 blocks", () => {
    const body = Array.from({ length: 2001 }, () => ({ type: "divider" }));
    expect(validate(mini(body)).errors.some((e) => e.message.includes("limit is 2000"))).toBe(true);
  });
});

describe("warnings", () => {
  it("touch target under 44 px", () => {
    const r = validate(mini([{ type: "button", label: "Go", style: { height: 30 } }]));
    expect(r.errors).toEqual([]);
    expect(paths(r.warnings)).toEqual(["$.screens[0].body[0].style.height"]);
  });
  it("more than three type sizes on a screen", () => {
    const body = [12, 14, 16, 20].map((fontSize) => ({ type: "text", value: "a", style: { fontSize } }));
    expect(validate(mini(body)).warnings.map((w) => w.message).join()).toContain("type sizes");
  });
  it("inconsistent spacing", () => {
    const body = [4, 6, 9, 13, 17].map((gap) => ({ type: "stack", style: { gap } }));
    expect(validate(mini(body)).warnings.map((w) => w.message).join()).toContain("spacing");
  });
  it("list without an empty state", () => {
    const r = validate(mini([{ type: "list", from: "{{ goals }}" }]));
    expect(r.warnings.map((w) => w.message)).toEqual(["List has no empty state."]);
  });
  it("chart without a label", () => {
    expect(validate(mini([{ type: "chart", kind: "bar", from: "a", x: "item.a", y: "item.b" }])).errors.map((w) => w.message)).toEqual(["Chart has no label."]);
  });
  it("action without a description", () => {
    const r = validate(mini([], { actions: { ping: { do: [{ toast: "hi" }] } } }));
    expect(paths(r.warnings)).toEqual(["$.actions.ping"]);
  });
});

describe("CEL syntax", () => {
  it("accepts typical expressions", () => {
    for (const e of ["a ? b : c", "x.filter(c, c.s == 'ok').map(c, c.n)", "{'a': 1, 'b': [1, 2]}", "!has_more", "a in [1,2]", "-x * (y + 2) % 3", "r'raw\\d'", "list[0].name"]) {
      expect(celSyntaxError(e), e).toBeUndefined();
    }
  });
  it("rejects broken expressions", () => {
    for (const e of ["", "1 +", "(1", "a b", "'open", "a.", "x[", "@"]) {
      expect(celSyntaxError(e), e).toBeDefined();
    }
  });
});

describe("fuzz", () => {
  function rnd(seed: number) {
    let s = seed;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }
  const keys = ["spec", "app", "screens", "theme", "palette", "data", "actions", "body", "type", "label", "source", "get", "do", "http", "permissions", "network", "children", "when", "value", "__proto__", "constructor"];
  it("never throws on random JSON", () => {
    const r = rnd(42);
    const gen = (d: number): unknown => {
      const k = Math.floor(r() * (d > 5 ? 5 : 8));
      switch (k) {
        case 0: return null;
        case 1: return r() < 0.5;
        case 2: return Math.floor(r() * 2000) - 1000 + (r() < 0.3 ? 0.5 : 0);
        case 3: return ["", "{{", "{{ a +", "#fff", "shipvo.app/v0", "https://x.io/a", "sk_live_abcdefgh12345678", "text", "button", "list"][Math.floor(r() * 10)]!;
        case 4: return Array.from({ length: Math.floor(r() * 4) }, () => gen(d + 1));
        default: {
          const o: Record<string, unknown> = {};
          for (let i = 0, n = Math.floor(r() * 5); i < n; i++) o[keys[Math.floor(r() * keys.length)]!] = gen(d + 1);
          return o;
        }
      }
    };
    for (let i = 0; i < 3000; i++) {
      const v = gen(0);
      expect(() => validate(v)).not.toThrow();
      const res = validate(v);
      expect(Array.isArray(res.errors) && Array.isArray(res.warnings)).toBe(true);
    }
  });
  it("survives deep nesting and odd values", () => {
    let deep: unknown = { type: "stack" };
    for (let i = 0; i < 5000; i++) deep = { type: "stack", children: [deep] };
    expect(() => validate(mini([deep]))).not.toThrow();
    for (const v of [undefined, NaN, Infinity, "x", 1n, () => 1, Symbol("s")]) expect(() => validate(v as unknown)).not.toThrow();
  });
});
