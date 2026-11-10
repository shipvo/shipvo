import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { checkNames } from "../src/check";
import { evaluate, evaluateTemplate, ExpressionError, validate } from "../src/index";

const NOW = "2026-11-06T10:30:00Z";
const scope = {
  xs: [3, 1, 2],
  cs: [{ a: 1, s: "x" }, { a: 5, s: "y" }, { a: 2, s: "x" }]
};
const ev = (e: string, o = {}) => evaluate(e, scope, { now: NOW, ...o });

describe("evaluate: numbers and lists", () => {
  it("sum", () => expect(ev("sum(xs)")).toBe(6));
  it("avg", () => expect(ev("avg(xs)")).toBe(2));
  it("min", () => expect(ev("min(xs)")).toBe(1));
  it("max", () => expect(ev("max(xs)")).toBe(3));
  it("count", () => expect(ev("count(xs)")).toBe(3));
  it("unique", () => {
    expect(ev("unique(cs, 's')")).toEqual(["x", "y"]);
    expect(ev("unique([1, 1, 2])")).toEqual([1, 2]);
  });
  it("sortBy", () => {
    expect(ev("sortBy(cs, 'a', 'desc').map(c, c.a)")).toEqual([5, 2, 1]);
    expect(ev("sortBy(cs, 'a').map(c, c.a)")).toEqual([1, 2, 5]);
  });
  it("groupBy", () => expect(ev("groupBy(cs, 's')")).toEqual({ x: [scope.cs[0], scope.cs[2]], y: [scope.cs[1]] }));
  it("first and last", () => {
    expect(ev("first(xs)")).toBe(3);
    expect(ev("last(xs)")).toBe(2);
  });
  it("take", () => expect(ev("take(xs, 2)")).toEqual([3, 1]));
  it("macros and mixed number literals", () => {
    expect(ev("xs.filter(x, x > 1).map(x, x * 2)")).toEqual([6, 4]);
    expect(ev("size(xs) + 1")).toBe(4);
    expect(ev("sum(xs) / 4 - 1")).toBe(0.5);
  });
  it("a bad argument is an error, not a crash", () => {
    expect(() => ev("sum(5)")).toThrow(ExpressionError);
    expect(() => ev("max([])")).toThrow(/non-empty/);
  });
});

describe("evaluate: dates", () => {
  it("today", () => expect(ev("today()")).toBe("2026-11-06T00:00:00.000Z"));
  it("startOf", () => {
    expect(ev("startOf('day', now)")).toBe("2026-11-06T00:00:00.000Z");
    expect(ev("startOf('week', now)")).toBe("2026-11-02T00:00:00.000Z");
    expect(ev("startOf('month', now)")).toBe("2026-11-01T00:00:00.000Z");
  });
  it("endOf", () => expect(ev("endOf('month', now)")).toBe("2026-11-30T23:59:59.999Z"));
  it("startOf uses the person's time zone", () => {
    expect(ev("startOf('day', now)", { timeZone: "Asia/Tokyo" })).toBe("2026-11-05T15:00:00.000Z");
  });
  it("addDays", () => expect(ev("addDays(now, 30)")).toBe("2026-12-06T10:30:00.000Z"));
  it("diffDays", () => expect(ev("diffDays('2026-11-06', '2026-11-01')")).toBe(5));
  it("formatDate", () => {
    expect(ev("formatDate(now, 'day')")).toBe("Nov 6, 2026");
    expect(ev("formatDate(now, 'day')", { locale: "de-DE" })).toBe("06.11.2026");
  });
  it("unix", () => expect(ev("unix(now)")).toBe(1793961000));
});

describe("evaluate: formatting uses the locale", () => {
  it("money", () => {
    expect(ev("money(1234.5, 'EUR')")).toBe("€1,234.50");
    expect(ev("money(1234.5, 'EUR')", { locale: "de-DE" })).toBe("1.234,50\u00a0€");
  });
  it("number", () => {
    expect(ev("number(1234.5678)")).toBe("1,234.568");
    expect(ev("number(2, 2)")).toBe("2.00");
  });
  it("percent", () => expect(ev("percent(0.256)")).toBe("25.6%"));
  it("compact", () => expect(ev("compact(12345)")).toBe("12.3K"));
});

describe("evaluate: text and fallbacks", () => {
  it("lower, upper, trim", () => {
    expect(ev("lower('AbC')")).toBe("abc");
    expect(ev("upper('abc')")).toBe("ABC");
    expect(ev("trim('  a ')")).toBe("a");
  });
  it("split and join", () => {
    expect(ev("split('a,b', ',')")).toEqual(["a", "b"]);
    expect(ev("join(['a', 'b'], '-')")).toBe("a-b");
  });
  it("built-in contains, startsWith, matches", () => {
    expect(ev("'hello'.contains('ell')")).toBe(true);
    expect(ev("'hello'.startsWith('he')")).toBe(true);
    expect(ev("'hello'.matches('h.*o')")).toBe(true);
  });
  it("csv", () => {
    const rows = [{ title: "A, B", note: 'say "hi"', tags: ["x", "y"], n: 2 }, { title: "line\nbreak", n: null }];
    expect(evaluate("csv(rows, ['title','note','tags','n'])", { rows })).toBe(
      'title,note,tags,n\r\n"A, B","say ""hi""",x; y,2\r\n"line\nbreak",,,\r\n'
    );
    expect(String(evaluate("csv(rows)", { rows })).split("\r\n")[0]).toBe("title,note,tags,n");
    expect(ev("csv([], ['a'])")).toBe("a\r\n");
  });

  it("csv: a null in a list is empty, an object in a list is JSON, and 3 arguments are refused", () => {
    expect(evaluate("csv(rows, ['t'])", { rows: [{ t: ["a", null, "b"] }] })).toBe("t\r\na;; b\r\n".replace(";; b", "; ; b"));
    expect(evaluate("csv(rows, ['t'])", { rows: [{ t: [{ k: 1 }] }] })).toBe('t\r\n"{""k"":1}"\r\n');
    expect(() => evaluate("csv(rows, ['t'], 1)", { rows: [] })).toThrow();
  });

  it("orElse", () => {
    expect(ev("orElse(null, 'x')")).toBe("x");
    expect(ev("orElse('a', 'x')")).toBe("a");
    expect(evaluate("orElse(p.name, 'Unknown')", { p: { name: null } })).toBe("Unknown");
  });
});

describe("evaluate: limits", () => {
  it("refuses over 2,000 characters", () => {
    expect(() => ev("1" + " + 1".repeat(700))).toThrow(/2000/);
  });
  it("refuses an expression over the cost limit", () => {
    const deep = "[1,2].filter(a, [1,2].filter(b, [1,2].filter(c, [1,2].filter(d, d > 0)).size() > 0).size() > 0)";
    expect(() => ev(deep)).toThrow(/costs/);
  });
  it("refuses a regex that can hang", () => {
    expect(() => evaluate("s.matches('(a+)+$')", { s: "a".repeat(40) + "b" })).toThrow();
  });
  it("refuses alternation under a repeat", () => {
    expect(() => evaluate("s.matches('^(a|aa)+$')", { s: "a".repeat(34) + "!" })).toThrow(/not allowed/);
    expect(() => evaluate("s.matches('(a|aa)+$')", { s: "a" })).toThrow(/not allowed/);
  });
  it("supports modulo", () => {
    expect(ev("10 % 3")).toBe(1);
    expect(evaluate("x % 2 == 0", { x: 8 })).toBe(true);
    expect(evaluate("x % 2 == 0", { x: 7 })).toBe(false);
    expect(() => ev("5 % 0")).toThrow(ExpressionError);
  });
  it("division by zero throws instead of returning null", () => {
    expect(() => ev("1 / 0")).toThrow(ExpressionError);
    expect(() => ev("-1 / 0")).toThrow(ExpressionError);
    expect(() => ev("0 / 0")).toThrow(ExpressionError);
  });
  it("unknown names fail instead of guessing", () => expect(() => ev("nope")).toThrow(ExpressionError));
});

describe("evaluateTemplate", () => {
  it("a single {{ }} keeps the type", () => {
    expect(evaluateTemplate("{{ xs }}", scope)).toEqual([3, 1, 2]);
    expect(evaluateTemplate(" {{ sum(xs) }} ", scope)).toBe(6);
  });
  it("mixed text becomes a string", () => {
    expect(evaluateTemplate("Total {{ sum(xs) }} of {{ count(xs) }}.", scope)).toBe("Total 6 of 3.");
  });
  it("plain text is unchanged", () => expect(evaluateTemplate("hello", scope)).toBe("hello"));
});

describe("validate: names", () => {
  const spec = (value: string, extra: Record<string, unknown> = {}) => ({
    spec: "shipvo.app/v0",
    app: { id: "mini", name: "Mini" },
    data: { revenueToday: { source: "computed", value: "{{ 1 }}" } },
    state: { period: { type: "enum", options: ["day"], default: "day" } },
    screens: [{ id: "home", body: [{ type: "text", value }] }],
    ...extra
  });
  it("a misspelled data name gets a path and a suggestion", () => {
    const r = validate(spec("{{ money(revenueToday, 'EUR') }} {{ revenueTodya }}"));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.path).toBe("$.screens[0].body[0].value");
    expect(r.errors[0]!.fix).toContain('"revenueToday"');
  });
  it("a misspelled state field is caught", () => {
    const r = validate(spec("{{ state.perod }}"));
    expect(r.errors[0]!.message).toContain("perod");
    expect(r.errors[0]!.fix).toContain('"period"');
  });
  it("a misspelled function is caught, and arity is checked", () => {
    expect(validate(spec("{{ monye(1, 'EUR') }}")).errors[0]!.fix).toContain('"money"');
    expect(validate(spec("{{ money(1) }}")).errors[0]!.message).toContain("2 arguments");
  });
  it("macro variables and has() are fine", () => {
    expect(validate(spec("{{ [1].map(x, x + 1) }} {{ has(state.period) }}")).errors).toEqual([]);
  });
  it("input is checked against the action's inputs", () => {
    const actions = { a: { description: "d", input: { title: { type: "text" } }, do: [{ return: "{{ input.titel }}" }] } };
    const r = validate(spec("x", { actions }));
    expect(r.errors[0]!.path).toBe("$.actions.a.do[0].return");
    expect(r.errors[0]!.fix).toContain('"title"');
  });
  it("item is not available outside screens", () => {
    expect(validate(spec("x", { data: { v: { source: "computed", value: "{{ item.a }}" } } })).errors[0]!.message).toContain('"item"');
  });
  it("an expression over the cost limit is a validation error", () => {
    const deep = "[1].filter(a, [1].filter(b, [1].filter(c, [1].filter(d, d > 0)).size() > 0).size() > 0)";
    const r = validate(spec(`{{ ${deep} }}`));
    expect(r.errors[0]!.message).toContain("costs");
  });
});

describe("checkNames nested fields", () => {
  it("does not flag item.x or other nested fields", () => {
    const scope = { names: { items: undefined } };
    expect(checkNames("items.map(item, item.x + item.y.z)", scope)).toEqual([]);
    expect(checkNames("items.filter(i, i.a.b > 0)", scope)).toEqual([]);
  });
});

describe("package hygiene", () => {
  it("has no eval, Function or dynamic import in src", () => {
    const dir = new URL("../src/", import.meta.url);
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const code = readFileSync(new URL(f, dir), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      expect(code, f).not.toMatch(/\beval\s*\(|new\s+Function\b|\bFunction\s*\(|\bimport\s*\(/);
    }
  });
});
