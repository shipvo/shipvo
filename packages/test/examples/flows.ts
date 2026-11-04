// Three failure-path flows, written against the Tide & Tackle sample app.
// Each takes a phone, so you can call it from any test. Change the labels to match your app.
import { expect } from "vitest";
import type { Phone } from "../src/phone.js";

/** The customer says no to the location prompt. The app must explain, not crash. */
export async function permissionDenied(phone: Phone): Promise<void> {
  await phone.device.set({ permissions: { location: "undetermined" } });
  await phone.tap("Use my location");
  expect(phone.sees("access this device's location")).toBe(true);
  await phone.tap("Deny");
  await phone.waitFor("Location permission was not granted.");
}

/** The phone loses its connection. The app must say so. */
export async function offline(phone: Phone): Promise<void> {
  await phone.device.set({ online: false });
  await phone.waitFor("You're offline");
  await phone.device.set({ online: true });
  await phone.waitForGone("You're offline");
}

/** The mobile money provider declines the charge. The customer sees why and can retry. */
export async function paymentDecline(phone: Phone): Promise<void> {
  await phone.device.set({ payment: { nextResult: "decline" } });
  await phone.tap("Pay and place order");
  await phone.type("Mobile money PIN", "1234");
  await phone.tap("Confirm payment");
  await phone.waitFor("Payment declined");
  expect(phone.nodes().some((n) => n.role === "button" && n.name === "Confirm payment")).toBe(true);
}
