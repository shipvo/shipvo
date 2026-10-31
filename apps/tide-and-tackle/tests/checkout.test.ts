// The full purchase, written the way a developer would write it: typed, in Vitest, against the Shipvo simulator.
// `npm run sim` (or the CI step in .github/workflows/ci.yml) starts the simulator; no phone or emulator is involved.
import { test, expect, openApp } from "@shipvo/test/vitest";

test("scan a product, pay with mobile money and a fingerprint, get the confirmation", async ({ phone }) => {
  await phone.device.set({
    camera: { barcode: { type: "qr", data: "6181234567890" } },
    location: { latitude: 4.0225, longitude: 9.6967 },
    biometrics: { enrolled: true, nextResult: "success" },
    payment: { nextResult: "approve", pin: "1234" },
  });

  // camera permission, then the scan resolves to a product
  await phone.tap("Scan a product barcode");
  expect(phone).toSee("Allow Tide & Tackle to take pictures");
  await phone.tap("While using the app");
  await phone.waitFor("Add 1 to cart");
  expect(phone).toSee("Surface Popper 9 cm");
  await phone.tap("Add 1 to cart");

  // location permission, then the distance from the shop
  await phone.tap(/^Open cart/);
  await phone.tap("Choose delivery and pay");
  await phone.tap("Use my location");
  expect(phone).toSee("access this device's location");
  await phone.tap("While using the app");
  await phone.waitFor(/0\.7 km/);

  // pickup, mobile money, fingerprint, PIN
  await phone.tap(/^Any day Shop pickup/);
  await phone.tap("Mobile money");
  await phone.type("Mobile money number", "677000111");
  await phone.tap("Place order");
  expect(phone).toSee("Confirm with fingerprint");
  await phone.tap("Use fingerprint");
  expect(phone).toSee("Mobile money PIN");
  await phone.type("Mobile money PIN", "1234");
  await phone.tap("Confirm payment");

  await phone.waitFor(/Order TT-\d+ placed/);
  expect(phone).toSee(/SIMULATED-[A-Z0-9]+/);
  expect(phone).toSee(/Notification: Order TT-\d+ confirmed/);
});

test("a declined payment is reported and no order is placed", async () => {
  // Start with a rod already in the cart (a test shortcut), and tell the phone the bank will say no.
  const phone = await openApp({ seedCart: [{ product_id: "rod-surf-36", quantity: 1 }], device: { payment: { nextResult: "decline", pin: "1234" }, biometrics: { enrolled: true, nextResult: "success" } } });
  await phone.tap(/^Open cart/);
  await phone.tap("Choose delivery and pay");
  await phone.tap(/^Any day Shop pickup/);
  await phone.tap("Mobile money");
  await phone.type("Mobile money number", "677000111");
  await phone.tap("Place order");
  await phone.tap("Use fingerprint");
  await phone.type("Mobile money PIN", "1234");
  await phone.tap("Confirm payment");
  await phone.waitFor("Payment declined");
  expect(phone.sees(/Order TT-\d+ placed/)).toBe(false);
});
