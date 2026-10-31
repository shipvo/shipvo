# Device API reference (`@shipvo/device`)

One API, two implementations. On phones it wraps the Expo modules you install. In the simulator it is a **simulated device**: the system dialogs are drawn as real dialogs in the accessibility tree, and the agent (or test) sets what the phone has. The app code is identical.

```ts
import { device } from "@shipvo/device";
```

## Support levels

```ts
device.kind                 // "native" | "simulated"
device.capabilities()       // { camera: "real" | "simulated" | "unavailable", location: …, biometrics, payments, notifications, share, clipboard, network }
```

Every capability declares how it is provided *here*. There is no silent fallback: on a phone without `expo-camera` installed, `camera` is `unavailable` and `scan()` throws; in the simulator every capability is `simulated`. Tests and agents read this to know what was actually exercised. Simulated results are also marked in what they return: receipts start with `SIMULATED-` (simulator) or `SANDBOX-` (the built-in sandbox provider on phones until a gateway is configured), and every entry in the simulator's device log carries `simulated: true`.

## Permissions

```ts
await device.permissions.get("camera" | "location" | "notifications")      // "granted" | "denied" | "undetermined"
await device.permissions.request("camera" | "location" | "notifications")
```

On phones: the Expo permission calls. In the simulator: the platform's own dialog, worded as Android ("Allow My Shop to take pictures and record video?" with *While using the app / Only this time / Deny*) or iOS ("“My Shop” Would Like to Access the Camera" with *Allow / Don't Allow*) words it, depending on the simulated device's `platform`. Android below API 33 grants notifications without asking, as the OS does. The answer is remembered for the session.

## Location

```ts
const c = await device.location.current();     // { latitude, longitude, accuracy? }
```

Asks for foreground permission first (so the system dialog appears on the first use, on phones and in the simulator), then reads one position. Throws `Location permission denied` when refused. Simulator default: 4.0225, 9.6967 (Douala); set with `set_device`.

## Camera: scanning codes

```ts
const r = await device.camera.scan({ prompt: "Point at the barcode" });   // { type, data } | null (cancelled)
```

On phones the scanner is a screen; mount `<ScanHost accent="#1F4E5F" />` from `@shipvo/device/scan` once at your app root and `scan()` shows it (camera preview with EAN-13/EAN-8/QR/Code-128 decoding, a manual-entry field for scratched packs and weak cameras, cancel). Apps with their own scanner screen can skip `ScanHost` and use `expo-camera` directly; the simulator swaps `expo-camera` for its simulated one through the Metro alias.

In the simulator the camera "sees" whatever `set_device` put in front of it: `camera: { barcode: { type: "qr", data: "6181234567890" }, delayMs: 800 }`. With no barcode set, the viewfinder stays open until cancelled.

## Biometrics

```ts
const ok = await device.auth.available();                       // hardware present and enrolled
const r = await device.auth.confirm("Confirm payment of 4 200 FCFA");
// { ok: true } | { ok: false, reason: "cancelled" | "failed" | "unavailable" | "not_enrolled" }
```

Phones: `expo-local-authentication` (fingerprint, Face ID, device PIN fallback). Simulator: a fingerprint (Android) or Face ID (iOS) prompt in the tree; `set_device` chooses `biometrics: { enrolled, nextResult: "success" | "fail" | "cancel" }`. Nothing is verified; the log says so.

## Payments

```ts
const r = await device.pay.charge({ provider: "mobile_money" | "card", amount, currency, to, reference, phone? }, pin);
// { ok: true, receipt } | { ok: false, reason: "declined" | "cancelled" | "timeout" | "insufficient_funds" }
```

The amount/PIN prompt is your app's own sheet, identical on every platform (Tide & Tackle's `PaymentSheet` is a reference). The provider decides the outcome. Today the provider on phones is a sandbox (PIN 1234 approves, receipt `SANDBOX-…`); the simulator approves, declines, times out or reports insufficient funds as `set_device` says (`payment: { nextResult, pin }`), receipt `SIMULATED-…`. **No money moves anywhere yet**; a real mobile-money or card gateway plugs in behind this interface.

## Notifications

```ts
const id = await device.notifications.show({ title, body, data? });
const off = device.notifications.onOpen((n) => { /* n.data */ });
```

Phones: a local notification through `expo-notifications`; tapping it fires `onOpen`. Simulator: a heads-up banner over the status bar for 5 seconds (as on a phone), then it lives in the notification shade: agents list it with the `notifications` MCP tool and tap it with `open_notification`, which fires `onOpen` exactly as a banner tap would.

## Share and clipboard

```ts
await device.share.text("Order TT-1001: …", "My order");   // true if shared
await device.clipboard.set(text); await device.clipboard.get();
```

Simulator: a share sheet with WhatsApp / Messages / Copy; Copy writes the simulated clipboard.

## Network

```ts
device.net.online();                        // boolean
device.net.onChange((online) => …);
```

Simulator: `set_device(online: false)` takes the phone offline; the app's offline banner and queued actions can be tested without touching a radio.

## The simulated device from the agent's side

| MCP tool | Effect |
| --- | --- |
| `set_device(session, platform?, api?, permissions?, location?, camera?, biometrics?, payment?, online?)` | Change any part of the device state mid-session |
| `device_reset(session, profile?)` | Back to a known state: permissions undetermined, default location, nothing in view, log cleared |
| `push_notification(session, title, body, data?)` | Deliver a notification to the phone |
| `notifications(session)` / `open_notification(session, id?)` | The shade; tap one |
| `device_log(session)` | Every device event in the session (permission prompts and answers, location reads, scans, auth, payments, notifications, shares), each `simulated: true`, plus `capabilities()` |

## Using raw Expo modules

Apps that already import `expo-camera`, `expo-location`, `expo-local-authentication` or `expo-notifications` directly also run in the simulator: `withShipvoSim` in `metro.config.js` aliases them to shims that call the simulated device when the bundle is built with `PN_SIM=1`. Phone builds are untouched.
