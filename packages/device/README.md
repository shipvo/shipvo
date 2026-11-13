# @shipvo/device

One device API for Shipvo apps, implemented twice:

- **On phones:** thin wrappers over the Expo modules you install (`expo-camera`, `expo-location`, `expo-local-authentication`, `expo-notifications`, `expo-clipboard`).
- **In the Shipvo simulator:** a simulated device. Permission dialogs, the camera viewfinder, the fingerprint prompt, the payment prompt, notification banners and the share sheet are drawn as real dialogs, so an AI agent sees and operates them exactly as on a phone, and the simulator can set what the device "has": location, a barcode in front of the camera, whether the fingerprint will match, whether the payment will be approved, network on or off.

```ts
import { device } from "@shipvo/device";
const here = await device.location.current();          // permission dialog appears the first time
// Real camera, microphone and location are used only after the (simulated) permission is granted, a person is present and the browser allows it.
// A denied or undetermined-then-refused permission never reaches the hardware.
const code = await device.camera.scan({ prompt: "Scan the product barcode" });
const auth = await device.auth.confirm("Confirm payment of 10 710 FCFA");   // { ok } | { ok: false, reason }
const paid = await device.pay.charge({ provider: "mobile_money", amount: 10710, currency: "FCFA", to: "Tide & Tackle", reference: "TT-1001", phone: "677000111" }, pin);
await device.notifications.show({ title: "Order confirmed", body: "TT-1001 is being prepared" });
```

Apps that import Expo modules directly also work in the simulator: add `withShipvoSim` from `@shipvo/device/metro` to `metro.config.js`.

Simulator builds can also run your app's Android and iOS code. Add the Babel plugin `@shipvo/device/babel` for builds with `PN_SIM` set, and `Platform.OS` and `Platform.select` follow the phone the session simulates. Pass `{ nativeFiles: true }` to `withShipvoSim` and relative imports pick `.native.js` files. Both apply to your own files only. See `docs/device-api.md` in the repo.


On phones, mount `<ScanHost />` from `@shipvo/device/scan` once at the app root so `device.camera.scan()` has a screen to show. Full reference: `docs/device-api.md` in the repo.
