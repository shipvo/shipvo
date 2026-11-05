import { describe, expect, it } from "vitest";
import { dataSafetyCsv, deriveStoreDetails, renderPrivacyPolicy, type StoreManifest } from "../src/index";

const app = (capabilities?: string[], extra: Partial<StoreManifest["listing"]> = {}): StoreManifest => ({ appId: "shop", name: "Shop", listing: { capabilities, ...extra } });
const none = app([]);
const contacts = app(["contacts"]);
const three = app(["contacts", "location", "camera"], { website: "https://shop.test" });

describe("deriveStoreDetails", () => {
  it("no capabilities: no rows, no data-type questions", () => {
    const d = deriveStoreDetails(none);
    expect(d.rows).toEqual([]);
    expect(d.unknown.map((u) => u.id)).toEqual(["contact"]);
  });
  it("contacts only: one row and its questions", () => {
    const d = deriveStoreDetails(contacts);
    expect(d.rows.map((r) => r.capability)).toEqual(["contacts"]);
    expect(d.rows[0].dataType.typeId).toBe("PSL_CONTACTS");
    expect(d.unknown.map((u) => u.id)).toEqual(["shared:contacts", "leaves-device", "retention", "encryption", "contact"]);
  });
  it("contacts + location + camera: three rows, no contact question when a website is set", () => {
    const d = deriveStoreDetails(three);
    expect(d.rows.map((r) => r.capability)).toEqual(["contacts", "location", "camera"]);
    expect(d.unknown.map((u) => u.id)).toEqual(["shared:contacts", "shared:location", "shared:camera", "leaves-device", "retention", "encryption", "location-precision"]);
  });
  it("lists a capability that is not in the table as unknown", () => {
    const d = deriveStoreDetails(app(["contacts", "hologram", "constructor"]));
    expect(d.rows.map((r) => r.capability)).toEqual(["contacts"]);
    expect(d.unknown.map((u) => u.id)).toContain("capability:hologram");
    expect(d.unknown.map((u) => u.id)).toContain("capability:constructor");
  });
  it("capabilities that read no data are reported, not asked about", () => {
    const d = deriveStoreDetails(app(["share", "network"]));
    expect(d.noDataCapabilities).toEqual(["share", "network"]);
    expect(d.rows).toEqual([]);
  });
});

describe("privacy policy", () => {
  it("starts with the review header and names no data type for the no-capability app", () => {
    const p = renderPrivacyPolicy(deriveStoreDetails(none), none);
    expect(p.startsWith("> **Review before publishing.**")).toBe(true);
    for (const w of ["contacts", "location", "photo", "camera", "financial", "purchase", "device or other"]) expect(p.toLowerCase()).not.toContain(w);
  });
  it("names the declared data types and not others", () => {
    const p = renderPrivacyPolicy(deriveStoreDetails(contacts), contacts).toLowerCase();
    expect(p).toContain("contacts");
    expect(p).not.toContain("location");
  });
  it("flags an unmapped capability to fill in", () => {
    const m = app(["hologram"]);
    expect(renderPrivacyPolicy(deriveStoreDetails(m), m)).toContain("**hologram**");
  });
});

describe("dataSafetyCsv", () => {
  it("has a header and a row per data type, and does not assert collection", () => {
    const csv = dataSafetyCsv(deriveStoreDetails(three));
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("Question ID (machine readable)");
    expect(csv).not.toContain("COLLECTS_PERSONAL_DATA");
    expect(lines.filter((l) => l.startsWith("PSL_DATA_TYPES_"))).toHaveLength(3);
    expect(csv).toContain("unconfirmed");
  });
  it("a no-data app gets only the header", () => {
    expect(dataSafetyCsv(deriveStoreDetails(none)).trim().split("\n")).toHaveLength(1);
  });
  it("asks whether data leaves the device", () => {
    expect(deriveStoreDetails(contacts).unknown.find((u) => u.id === "leaves-device")?.question).toBe("Does any of this data leave the device?");
  });
  it("quotes fields with quotes, commas and newlines so they parse back", () => {
    const d = deriveStoreDetails(contacts);
    d.rows[0] = { ...d.rows[0], purpose: 'Say "hi", then\nleave' };
    const csv = dataSafetyCsv(d);
    expect(csv).toContain('"Purpose for Contacts: Say ""hi"", then\nleave"');
    const rec: string[][] = []; let f = "", row: string[] = [], inq = false;
    for (let i = 0; i < csv.length; i++) { const c = csv[i];
      if (inq) { if (c === '"' && csv[i + 1] === '"') { f += '"'; i++; } else if (c === '"') inq = false; else f += c; }
      else if (c === '"') inq = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n") { row.push(f); rec.push(row); row = []; f = ""; } else f += c; }
    expect(rec.every((r) => r.length === 5)).toBe(true);
    expect(rec[rec.length - 1][4]).toBe('Purpose for Contacts: Say "hi", then\nleave');
  });
  it("quotes values that contain commas", () => {
    const d = deriveStoreDetails(contacts);
    d.rows[0] = { ...d.rows[0], purpose: "A, B" };
    expect(dataSafetyCsv(d)).toContain('"Purpose for Contacts: A, B"');
  });
});
