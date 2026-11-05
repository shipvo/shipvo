import { beforeAll, expect, it } from "vitest";

// Runs the real simulated device (packages/device/src/index.web.ts) with a minimal document.
let dev: any; let pn: any;
beforeAll(async () => {
  const g = globalThis as any;
  g.window = { dispatchEvent: () => true, addEventListener() {}, removeEventListener() {} };
  g.CustomEvent = class {};
  g.document = { querySelectorAll: () => [], createElement: () => ({ style: {}, append() {}, appendChild() {}, setAttribute() {} }), body: { append() {}, appendChild() {} } };
  dev = (await import("../../device/src/index.web")).device; pn = g.__pnDevice;
});

const amina = { id: "1", name: "Amina Njoya", phoneNumbers: ["+237655001122"], emails: ["amina@example.com"] };

it("declares contacts as simulated", () => { expect(dev.capabilities().contacts).toBe("simulated"); });

it("returns seeded contacts once permission is granted", async () => {
  pn.reset(); pn.set({ contacts: [amina], permissions: { contacts: "granted" } });
  expect(await dev.contacts.getAll()).toEqual([amina]);
  expect(pn.log().some((l: any) => l.kind === "contacts" && l.detail.count === 1)).toBe(true);
});

it("throws the device's error when permission is denied", async () => {
  pn.reset(); pn.set({ contacts: [amina], permissions: { contacts: "denied" } });
  await expect(dev.contacts.getAll()).rejects.toThrow("Contacts permission denied");
});

it("reset clears the address book and the permission", async () => {
  pn.reset();
  expect(pn.state.contacts).toEqual([]); expect(pn.state.permissions.contacts).toBe("undetermined");
});
