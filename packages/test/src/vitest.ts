// Vitest integration: a `phone` fixture (a fresh simulated phone per test) and screen matchers.
//   import { test, expect } from "@shipvo/test/vitest";
//   test("checkout", async ({ phone }) => { await phone.tap("Add to cart"); expect(phone).toSee("Cart (1)"); });
import { expect, test as base } from "vitest";
import { openApp, type Phone } from "./phone.js";

interface ShipvoMatchers<R = unknown> {
  /** The phone's current screen contains this text or pattern. */
  toSee(text: string | RegExp): R;
  /** There is a button with this name (exact, or a pattern) on screen. */
  toHaveButton(name: string | RegExp): R;
}
declare module "vitest" {
  interface Assertion<T = any> extends ShipvoMatchers<T> {}
  interface AsymmetricMatchersContaining extends ShipvoMatchers {}
}

const show = (t: string | RegExp) => (t instanceof RegExp ? String(t) : JSON.stringify(t));
expect.extend({
  toSee(phone: Phone, text: string | RegExp) {
    const pass = phone.sees(text);
    return { pass, message: () => (pass ? `expected the screen not to show ${show(text)}\n\n${phone.screen}` : `expected the screen to show ${show(text)}\n\nScreen now:\n${phone.screen}`) };
  },
  toHaveButton(phone: Phone, name: string | RegExp) {
    const pass = phone.nodes().some((n) => n.role === "button" && (name instanceof RegExp ? name.test(n.name) : n.name === name));
    return { pass, message: () => (pass ? `expected no button ${show(name)}` : `expected a button ${show(name)}\n\nScreen now:\n${phone.screen}`) };
  },
});

/** A fresh simulated phone per test, closed afterwards. Needs the simulator running (npx shipvo sim). */
export const test = base.extend<{ phone: Phone }>({
  phone: async ({}, use) => { const phone = await openApp(); await use(phone); await phone.close(); },
});
export { expect, openApp };
export type { Phone };
