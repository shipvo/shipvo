import { describe, it, expect } from "vitest";
import { renderScreen, validate } from "../src/index.js";
import type { ScreenNode } from "../src/index.js";

const spec = {
  spec: "shipvo.app/v0",
  app: { id: "shop", name: "Shop" },
  strings: { fr: { "Revenue today": "Revenus du jour" } },
  screens: [{ id: "home", title: "Home", body: [
    { type: "text", value: "Revenue today" },
    { type: "text", value: "{{ money(1234.5, 'USD') }}" },
    { type: "text", value: "{{ formatDate('2026-11-09T00:00:00Z', 'day') }}" }
  ] }]
};
const names = (n: ScreenNode): string[] => [n.name, ...n.children.flatMap(names)];
const render = (o: object) => {
  const r = renderScreen(spec, o);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};

describe("translations and locale", () => {
  it("translates by language and keeps the original in en", () => {
    expect(names(render({ language: "fr" }).tree)).toContain("Revenus du jour");
    expect(names(render({ language: "en" }).tree)).toContain("Revenue today");
    expect(names(render({ language: "de" }).tree)).toContain("Revenue today");
  });

  it("formats money with Intl for the locale", () => {
    const fr = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD" }).format(1234.5);
    const us = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(1234.5);
    expect(names(render({ language: "fr", locale: "fr-FR" }).tree)).toContain(fr);
    expect(names(render({ locale: "en-US" }).tree)).toContain(us);
    expect(us).toBe("$1,234.50");
  });

  it("formats dates for the locale", () => {
    const fr = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", dateStyle: "medium" }).format(new Date("2026-11-09T00:00:00Z"));
    expect(names(render({ locale: "fr-FR" }).tree)).toContain(fr);
  });

  it("sets dir rtl for Arabic and Hebrew, ltr otherwise", () => {
    for (const locale of ["ar-EG", "he-IL"]) {
      const r = render({ locale });
      expect(r.tree.props?.dir).toBe("rtl");
      expect(r.html).toContain('dir="rtl"');
    }
    expect(render({ locale: "fr-FR" }).tree.props?.dir).toBe("ltr");
  });

  it("warns about strings keys no block uses", () => {
    const v = validate({ ...spec, strings: { fr: { "Revenue today": "x", "Nothing here": "y" } } });
    expect(v.errors).toEqual([]);
    expect(v.warnings.map((w) => w.path)).toEqual(['$.strings.fr["Nothing here"]']);
    expect(validate(spec).warnings).toEqual([]);
  });
});
