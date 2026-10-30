# @purenative/device

One device API for PureNative apps, implemented twice:

- **On phones:** thin wrappers over the Expo modules you install (`expo-camera`, `expo-location`, `expo-local-authentication`, `expo-notifications`, `expo-clipboard`).
- **In the PureNative simulator:** a simulated device. Permission dialogs, the camera viewfinder, the fingerprint prompt, the payment prompt, notification banners and the share sheet are drawn as real dialogs, so an AI agent sees and operates them exactly as on a phone, and the simulator can set what the device "has": location, a barcode in front of the camera, whether the fingerprint will match, whether the payment will be approved, network on or off.

```ts
import { device } from "@purenative/device";
const here = await device.location.current();          // permission dialog appears the first time
const code = await device.camera.scan({ prompt: "Scan the product barcode" });
const ok = await device.auth.confirm("Confirm payment of 10 710 FCFA");
const paid = await device.pay.present({ provider: "mobile_money", amount: 10710, currency: "FCFA", to: "Tide & Tackle", reference: "TT-1001", phone: "677000111" });
await device.notifications.show({ title: "Order confirmed", body: "TT-1001 is being prepared" });
```

Apps that import Expo modules directly also work in the simulator: add `withPureNativeSim` from `@purenative/device/metro` to `metro.config.js`.
