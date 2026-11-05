import { describe, expect, it } from "vitest";
import { deriveStoreDetails, renderDataSafetyCsv, renderPrivacyPolicy, DATA_CAPABILITIES } from "../src/index";

const app = (capabilities?: string[]) => ({ appId: "shop", name: "Shop", listing: capabilities ? { capabilities } : undefined });
const none = app();
const contacts = app(["contacts"]);
const three = app(["contacts", "location", "camera"]);

describe("deriveStoreDetails", () => {
  it("no capabilities: no rows, only the questions the manifest cannot answer", () => {
    const d = deriveStoreDetails(none);
    expect(d.rows).toEqual([]);
    expect(d.fill).toEqual({ filled: 0, total: 0 });
    expect(d.unknown.map((u) => u.id)).toEqual(["sdks", "accounts", "deletion", "contact"]);
  });

  it("contacts only: one row, shared is unknown", () => {
    const d = deriveStoreDetails(contacts);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({ capability: "contacts", dataType: "Contacts", collected: true, shared: "unknown", purpose: "App functionality" });
    expect(d.unknown.map((u) => u.id)).toContain("shared:contacts");
    expect(d.fill).toEqual({ filled: 2, total: 3 });
  });

  it("contacts + location + camera: three rows in declared order", () => {
    const d = deriveStoreDetails(three);
    expect(d.rows.map((r) => r.dataType)).toEqual(["Contacts", "Precise location", "Photos"]);
    expect(d.unknown.filter((u) => u.id.startsWith("shared:"))).toHaveLength(3);
  });

  it("a capability outside the table is listed as unknown, not dropped", () => {
    const d = deriveStoreDetails(app(["contacts", "telepathy"]));
    expect(d.rows.map((r) => r.capability)).toEqual(["contacts"]);
    expect(d.unknown.map((u) => u.id)).toContain("capability:telepathy");
    expect(d.unknown.find((u) => u.id === "capability:telepathy")!.question).toContain("telepathy");
  });

  it("inherited object names are not capabilities", () => {
    expect(deriveStoreDetails(app(["constructor"])).unknown.map((u) => u.id)).toContain("capability:constructor");
  });

  it("known capabilities with no data of their own make no row and are not unknown", () => {
    const d = deriveStoreDetails(app(["biometrics", "network"]));
    expect(d.rows).toEqual([]);
    expect(d.noDataCapabilities).toEqual(["biometrics", "network"]);
    expect(d.unknown.some((u) => u.id.startsWith("capability:"))).toBe(false);
  });

  it("repeated capabilities give one row", () => {
    expect(deriveStoreDetails(app(["camera", "camera"])).rows).toHaveLength(1);
  });
});

describe("renderPrivacyPolicy", () => {
  it("starts with the review header", () => {
    expect(renderPrivacyPolicy(deriveStoreDetails(none))).toMatch(/^> \*\*Draft\. Review before publishing\./);
  });

  it("names no data type when nothing is declared", () => {
    const p = renderPrivacyPolicy(deriveStoreDetails(none)).toLowerCase();
    for (const m of Object.values(DATA_CAPABILITIES)) {
      expect(p).not.toContain(m.dataType.toLowerCase());
      expect(p).not.toContain(m.category.toLowerCase());
    }
    for (const w of ["contacts", "location", "camera", "photo", "calendar", "payment"]) expect(p).not.toContain(w);
  });

  it("names exactly the declared data types", () => {
    const p = renderPrivacyPolicy(deriveStoreDetails(contacts));
    expect(p).toContain("**Contacts**");
    expect(p).not.toContain("Precise location");
  });
});

describe("renderDataSafetyCsv", () => {
  it("has the header and leaves the collects-data answer out when nothing is declared", () => {
    const csv = renderDataSafetyCsv(deriveStoreDetails(none)).split("\n");
    expect(csv[0]).toBe("Question ID,Response ID,Response value,Answer requirement,Human-friendly question label");
    expect(csv.join("\n")).not.toContain("PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA");
  });

  it("says data is collected when a capability touches user data", () => {
    expect(renderDataSafetyCsv(deriveStoreDetails(three))).toContain("PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA,,true");
  });

  it("writes purpose rows for derived answers and leaves unknown ones out", () => {
    const csv = renderDataSafetyCsv(deriveStoreDetails(three));
    expect(csv).toContain("PSL_DATA_USAGE_RESPONSES:PSL_CONTACTS:DATA_USAGE_COLLECTION_PURPOSE,PSL_APP_FUNCTIONALITY");
    expect(csv).not.toContain("COLLECTION_AND_SHARING");
  });
});
