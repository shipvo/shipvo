// Three failure-path flows, written against the Tide & Tackle sample app.
// Each takes a phone, so you can call it from any test. Change the labels to match your app.
// The checkout flows need a cart, so open the phone with a rod already in it:
//   openApp({ seedCart: [{ product_id: "rod-surf-36", quantity: 1 }] })
// See apps/tide-and-tackle/tests/checkout.test.ts for the same steps against the real app.
import { expect } from "@shipvo/test/vitest";
import type { Phone } from "@shipvo/test";

/** From the home screen with a seeded cart to the delivery screen. */
export async function openDelivery(phone: Phone): Promise<void> {
  await phone.tap(/^Open cart/);
  await phone.tap("Choose delivery and pay");
}

/** The customer says no to the location prompt. The app must explain, not crash. */
export async function permissionDenied(phone: Phone): Promise<void> {
  await openDelivery(phone);
  await phone.tap("Use my location");
  expect(phone).toSee("access this device's location");
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

/** Pick pickup and mobile money, place the order, pass the fingerprint, type the PIN and confirm. */
export async function payWithMobileMoney(phone: Phone): Promise<void> {
  await openDelivery(phone);
  await phone.tap(/^Any day Shop pickup/);
  await phone.tap("Mobile money");
  await phone.type("Mobile money number", "677000111");
  await phone.tap("Place order");
  await phone.tap("Use fingerprint");
  await phone.type("Mobile money PIN", "1234");
  await phone.tap("Confirm payment");
}

/** The mobile money provider declines the charge. The customer sees why and no order is placed. */
export async function paymentDecline(phone: Phone): Promise<void> {
  await phone.device.set({
    payment: { nextResult: "decline", pin: "1234" },
    biometrics: { enrolled: true, nextResult: "success" },
  });
  await payWithMobileMoney(phone);
  await phone.waitFor("Payment declined");
  expect(phone.sees(/Order TT-\d+ placed/)).toBe(false);
}
