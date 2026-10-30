# Simulator vs device parity

Can an agent trust the Shipvo UI simulator? We ran two complete purchases on the simulator and on the real app, then compared what an agent can act on and read on every screen.

- **Flow A:** browse the home rail → 2 × Chrome Spoon → Friday afternoon delivery → cash on delivery.
- **Flow B:** search "popper" → 3 × Surface Popper → promo code LURES15 → shop pickup → mobile money.

**Result: 100% actionable parity on both Android and iOS across all 13 screens; text coverage 98.6% (Android) and 96.2% (iOS). Both purchases completed on every side.** Bar: ≥ 99% actionable, ≥ 95% text.

| Flow | Screen | Android: actionable | Android: text | iOS: actionable | iOS: text |
| --- | --- | --- | --- | --- | --- |
| A | Home | 100% | 96% | 100% | 96% |
| A | Product | 100% | 100% | 100% | 100% |
| A | Added to cart | 100% | 100% | 100% | 100% |
| A | Cart | 100% | 95% | 100% | 95% |
| A | Checkout | 100% | 100% | 100% | 95% |
| A | Order placed | 100% | 100% | 100% | 89% |
| B | Search | 100% | 100% | 100% | 100% |
| B | Search results | 100% | 100% | 100% | 100% |
| B | Product | 100% | 100% | 100% | 100% |
| B | Cart | 100% | 95% | 100% | 95% |
| B | Promo applied | 100% | 96% | 100% | 96% |
| B | Checkout | 100% | 100% | 100% | 96% |
| B | Order placed | 100% | 100% | 100% | 89% |
| | **Mean** | **100%** | **98.6%** | **100%** | **96.2%** |

Previous run (one flow, before the simulator was made phone-faithful): Android 97.2% / 96.8%, iOS 100% / 90.0%.

- **Android:** release APK (OTA release 11) on an Android 11 emulator (Pixel 5 profile), GitHub Actions. Driven through Android's own accessibility tree (uiautomator over adb). "App isn't responding" dialogs: 0.
- **iOS:** Expo simulator build on the newest iPhone simulator, GitHub macOS runner. Driven with Appium XCUITest. No Apple Developer account.
- **Simulator:** the app's React Native Web build in a phone-sized headless browser, showing the same live content as devices.

## What made the simulator faithful

The gap was closed by making the simulator behave like a phone, not by loosening the comparison:

1. **Only on-screen rail items are exposed.** A horizontal product rail lists the items in view; an agent swipes it (`scroll right` with the rail's ref) to see more, exactly as on a device.
2. **Controls read as one label.** A button's inner text is grouped into its label, as Android and iOS do.
3. **Typing goes to the field a label names.** Typing "on" the *Promo code* heading reaches the *Promo code* field, as a person would.

The device drivers also learned to close the on-screen keyboard like a person (Back on Android, a drag on iOS), and to ignore the system keyboard and off-screen items in the device tree.

## A bug the parity run found

On iOS, the mobile-money number field opens a number pad with no Done key, and the checkout screen did not dismiss it on drag, so **Place order** was unreachable: a real customer paying by mobile money could not finish. Fixed in release 11 (keyboard closes on drag; content moves above it). The simulator, which has no on-screen keyboard, could not have found this; the device lanes exist for exactly this reason.

## Definitions (what the numbers do and do not measure)

- **Actionable parity:** the set of actionable elements on a screen (buttons, radio options, text fields, links, checkboxes), each reduced to `role:label`, compared as sets: shared elements divided by all elements seen on either side. Disabled controls count on both sides. Platform chrome (scroll indicators, keyboard keys) is excluded by the platform's own accessibility flags, not by name. **100% means: the agent can act on the same controls, with the same names, on both.** It is not a full accessibility-tree diff: enabled/disabled state, element order, bounds and field values are not part of the score yet.
- **Text coverage:** the share of text the simulator shows that also appears on the device, exactly or contained in a longer label.
- **Same order:** on every "Order placed" screen, the order itself (lines, total, delivery and payment) must be identical on both sides; receipts differ by provider (`SIMULATED-` vs `SANDBOX-`) and are normalised.
- **Visibility rules applied on both sides:** only on-screen items of a horizontal rail; nothing behind a modal sheet (the rule TalkBack and iOS apply; Android's uiautomator tree does not, so the Android driver applies it); the on-screen keyboard is never part of the app.

Planned, in this order: enabled/selected state in the match key; element order; nightly runs on clean installs with the published number being "runs at the bar out of runs"; a permission-denied flow.

## Known differences

1. **Text grouping on iOS:** iOS reads some rows as a single label where the web reads separate lines; the agent sees the same information, grouped differently. That is the remaining text gap (89% on "Order placed").
2. **On-screen keyboards** exist only on devices. Fields behave the same, but a device agent may need to dismiss the keyboard; the drivers do this.
3. **Native-only features** (camera, push, payment sheets) aren't in the simulator. Flows that need them run on the emulator or device lanes.

## Not covered yet

- **Real phones in automation:** LambdaTest automation needs a paid plan on this account (real devices: "Real Mobile App Automation not allowed"; emulators: "Native App Automation Virtual not allowed"). Manual App Live works. The native driver also runs on any USB-connected Android phone.
- **More flows:** two purchase flows today. The suite should grow with every template app.
- **Do not run parity during an OTA publish:** the emulator applies the update mid-flow (as designed) and the run is invalid.

How to reproduce: `.github/workflows/parity.yml` (Android) and `.github/workflows/parity-ios.yml` (iOS). Drivers: `apps/tide-and-tackle/sim/`.
