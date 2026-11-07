import { describe, expect, it } from "vitest";
import { deriveStoreDetails, renderPolicyText } from "../src/index";

const app = (caps: string[]) => deriveStoreDetails({ appId: "dev.x.app", name: "X", listing: { capabilities: caps } });
const full = { company: "Acme Ltd", contactEmail: "privacy@acme.test" };

describe("renderPolicyText", () => {
  it("camera and location produce exactly those two uses", () => {
    const { markdown, html } = renderPolicyText(app(["camera", "location"]), full);
    const uses = markdown.split("\n").filter((l) => l.includes("the app asks for the"));
    expect(uses).toHaveLength(2);
    expect(uses[0]).toContain("Photos");
    expect(uses[1]).toContain("Precise location");
    for (const w of ["contacts", "calendar", "payment"]) expect(markdown.toLowerCase()).not.toContain(`**${w}`);
    expect(html).toContain("<li>Precise location");
  });

  it("no data uses gives a short policy with no invented sections", () => {
    const { markdown } = renderPolicyText(app([]), full);
    const heads = markdown.split("\n").filter((l) => l.startsWith("#"));
    expect(heads).toEqual(["# Privacy policy for X", "## Contact", "## Still to confirm"]);
    expect(markdown).not.toContain("What the app uses");
    expect(markdown.split("\n").length).toBeLessThan(25);
  });

  it("lists missing contact fields and escapes html", () => {
    const d = deriveStoreDetails({ appId: "a", name: "<b>X</b>" });
    const r = renderPolicyText(d, { company: " " });
    expect(r.missing).toEqual(["listing.privacy.company", "listing.privacy.contactEmail"]);
    expect(r.html).not.toContain("<b>X");
    expect(renderPolicyText(d, full).missing).toEqual([]);
  });

  it("unknown capabilities become questions, not claims", () => {
    const { markdown } = renderPolicyText(app(["hologram"]), full);
    expect(markdown).toContain('Capability "hologram"');
    expect(markdown).not.toContain("the app asks for the hologram");
  });
});
