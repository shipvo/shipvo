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

## Plain-language steps

Write a test as plain lines, one step per line. Blank lines and lines starting with `#` are ignored. Quoted text is the element's accessibility name or text, as in `phone.tap("...")`.

```ts
import { openApp, parseSteps, runSteps } from "@shipvo/test";

const phone = await openApp();
await runSteps(phone, parseSteps(`
  # find a lure and put it in the cart
  type "popper" into "Search" and press enter
  tap "Add 1 to cart"
  wait for "Cart"
  do not see "Error"
  scroll down
  go back
`));
```

Lines: `tap "X"`, `type "X" into "Y"` (optional `and press enter`), `scroll down`, `go back`, `see "X"`, `do not see "X"`, `wait for "X"`. An unknown line throws a `PhoneError` with code `step_unparsed` and its line number. `runSteps` stops at the first failing step and names its line.

## Run on an Android emulator or iOS Simulator

Install [agent-device](https://github.com/callstack/agent-device) (MIT) and pick it as the device:

```bash
npm i -D agent-device
npx shipvo test --device agent-device --platform ios
npx shipvo lumi android --device agent-device
```

Or in code: `await openApp({ driver: "agent-device", platform: "android" })`, or `"device": "agent-device"` in shipvo.json. The screen tree, `tap`, `type`, `scroll`, `back` and `screenshot` work as on Shipvo Phone; element bounds come from the accessibility snapshot.

## Mock the network

Stub what the app's `fetch` gets back, so you can test slow, empty and failing responses without a backend. Requests that match no rule go to the network as usual.

```ts
import { test, expect } from "@shipvo/test/vitest";

test("shows an error when the catalogue is down", async ({ phone }) => {
  await phone.mockNetwork([
    { url: /\/api\/products/, status: 503, body: { error: "down" }, delayMs: 300 },
  ]);
  await phone.tap("Reload");
  await phone.waitFor(/try again/i);
  await phone.clearNetworkMocks(); // back to the real network
});
```

A rule has `url` (a string that must equal the full request URL, or a RegExp), an optional `method` (any method if left out), `status`, `body` (a string, or an object sent as JSON), optional `headers` and optional `delayMs`. The first matching rule wins, and each `mockNetwork` call replaces the earlier rules. Only `fetch` and XHR calls are stubbed. A bad rule throws a `PhoneError` with code `mock_invalid`.

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
