# @shipvo/test

Typed end-to-end tests for React Native apps that run in the Shipvo simulator. Open your app, tap, type, set the phone's location, camera, permissions, biometrics, payment result and network, and assert on what is on screen. Headless, so it runs in CI with no emulator and no device.

```ts
import { test, expect } from "@shipvo/test/vitest";

test("location: the app asks, then reads the phone's location", async ({ phone }) => {
  await phone.device.set({ location: { latitude: 4.0511, longitude: 9.7679 } });
  await phone.tap("Use my location");
  expect(phone).toSee("access this device's location");
  await phone.tap("While using the app");
  await phone.waitFor(/4\.05/);
});
```

```bash
npm i -D @shipvo/test vitest @shipvo/sim playwright
npx shipvo sim          # the simulator, http://localhost:4545
npx vitest run
```

## Failure-path examples

Runnable versions are in [`examples/flows.ts`](examples/flows.ts). They use the Tide & Tackle labels. Change them to match your app. The checkout flows need a cart, so open the phone with one: `openApp({ seedCart: [{ product_id: "rod-surf-36", quantity: 1 }] })`. The full purchase is in [`checkout.test.ts`](../../apps/tide-and-tackle/tests/checkout.test.ts).

**Permission denied**

```ts
await phone.tap(/^Open cart/);
await phone.tap("Choose delivery and pay");
await phone.tap("Use my location");
await phone.tap("Deny");
await phone.waitFor("Location permission was not granted.");
```

**Offline**

```ts
await phone.device.set({ online: false });
await phone.waitFor("You're offline");
```

**Payment decline**

```ts
await phone.device.set({ payment: { nextResult: "decline", pin: "1234" }, biometrics: { enrolled: true, nextResult: "success" } });
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
```

The tests for these flows run against a small fake simulator, not the real app. The fake follows the real screen order and button names.

Works with any runner through `openApp` from `@shipvo/test`. Full guide, CI workflow and API: [Test your app in CI](https://shipvo.dev/docs/testing/).
