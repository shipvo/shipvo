# Simulator vs device parity

This page is for developers and teams who want to know how far an agent's test on the Shipvo simulator carries over to a phone. You get the method, the numbers and the CI runs behind them, for Android and iOS.

Can an agent trust the Shipvo UI simulator? We ran two complete purchases on the simulator and on the real app, then compared what an agent can act on and read on every screen.

- **Flow A:** browse the home rail → 2 × Chrome Spoon → Friday afternoon delivery → cash on delivery.
- **Flow B:** search "popper" → 3 × Surface Popper → promo code LURES15 → shop pickup → mobile money.

**Result: 100% actionable parity on both Android and iOS across all 13 screens; text coverage 98.6% (Android) and 96.2% (iOS). Both purchases completed on every side.** Bar: ≥ 99% actionable, ≥ 95% text.

**What this measures:** the same actionable elements (role and label) on each screen, measured on an Android emulator and an iOS Simulator in CI.

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

## Flow C: native features (Android, release 19)

- **Flow C:** scan a product (manual barcode entry on both sides, see below) → "Use my location" → shop pickup → mobile money → order placed.

| Screen | Actionable | Text |
| --- | --- | --- |
| Camera permission dialog | 75% | 100% |
| Scanner | 100% | 100% |
| Scanned product | 100% | 100% |
| Location permission dialog | 75% | 75% |
| Located (distance shown, pickup) | 100% | 96% |
| Payment prompt | 67% | 83% |
| Order placed (same order ✓) | 100% | 91% |

Across all three flows on Android the orders match exactly; 18 of 21 screens are at 100% actionable parity. The three below 100% are known and listed here, not hidden: both system permission dialogs have one extra unlabeled button on the device, and the payment sheet's "Cancel payment" button is not exposed by Android's accessibility tree (same as flow B). On iOS (iPhone simulator, shell `dev.shipvo.tide`) flow C is at **100% actionable parity on all 6 screens, 95.3% mean text coverage on the full run, same order placed**: the iOS camera and location dialogs match word for word, driven through WebDriverAgent's alert interface (iOS system dialogs are outside the app's accessibility tree). Flows A and B on iOS are unchanged at 100%.

Flow C compares the scanner screen with the number typed into manual entry on both sides. Barcode decoding is covered by the simulated-camera end-to-end test (ChatGPT's 18-step run, `device_log` marked `simulated: true`).

**A bug flow C found:** on a phone, "Use my location" never showed the system permission dialog; the device API read the position without asking and the app reported "Could not get your location." Fixed in release 19 (`@shipvo/device` now requests permission first).

## Capacitor sample (apps/capacitor-sample)

The Capacitor sample's built web directory opens in the simulator on the Android and iOS skins. In CI, on both skins, the tree has stable refs (the same ref for "Show release number" in two snapshots), a tap on it shows "Release: embedded build", and a tap on a list item opens its detail screen with a Back button.

| App | Android skin | iOS skin | CI run |
| --- | --- | --- | --- |
| Capacitor sample | 1 of 1 flow passes, refs stable | 1 of 1 flow passes, refs stable | [ci run 42706961327](https://github.com/shipvo/shipvo/actions/runs/42706961327) (`packages/sim/capacitor-live.test.mjs`, tests 43 and 44) |

## What made the simulator faithful

The gap was closed by making the simulator behave like a phone, not by loosening the comparison:

1. **Only on-screen rail items are exposed.** A horizontal product rail lists the items in view; an agent swipes it (`scroll right` with the rail's ref) to see more, exactly as on a device.
2. **Controls read as one label.** A button's inner text is grouped into its label, as Android and iOS do.
3. **Typing goes to the field a label names.** Typing "on" the *Promo code* heading reaches the *Promo code* field, as a person would.

The device drivers also learned to close the on-screen keyboard like a person (Back on Android, a drag on iOS), and to ignore the system keyboard and off-screen items in the device tree.

## A bug the parity run found

On iOS, the mobile-money number field opens a number pad with no Done key, and the checkout screen did not dismiss it on drag, so **Place order** was unreachable: a real customer paying by mobile money could not finish. Fixed in release 11 (keyboard closes on drag; content moves above it). The simulator, which has no on-screen keyboard, could not have found this; the device lanes exist for exactly this reason.

## Definitions (what the numbers measure)

- **Actionable parity:** the set of actionable elements on a screen (buttons, radio options, text fields, links, checkboxes), each reduced to `role:label`, compared as sets: shared elements divided by all elements seen on either side. Disabled controls count on both sides, but their enabled state is not compared. Platform chrome (scroll indicators, keyboard keys) is excluded by the platform's own accessibility flags, not by name. **100% means: the agent can act on the same controls, with the same names, on both.** The score is computed on the `role:label` sets.
- **Text coverage:** the share of text the simulator shows that also appears on the device, exactly or contained in a longer label.
- **Same order:** on every "Order placed" screen, the order itself (lines, total, delivery and payment) must be identical on both sides; receipts differ by provider (`SIMULATED-` vs `SANDBOX-`) and are normalised.
- **Visibility rules applied on both sides:** only on-screen items of a horizontal rail; nothing behind a modal sheet (the rule TalkBack and iOS apply; Android's uiautomator tree does not, so the Android driver applies it); the on-screen keyboard is never part of the app.

## How the platforms read the same screen

1. **Text grouping on iOS:** iOS reads some rows as a single label where the web reads separate lines. The agent sees the same information, grouped differently (89% text coverage on "Order placed").
2. **On-screen keyboards** exist on devices. Fields behave the same, and the device drivers close the keyboard for the agent.
3. **Camera, push and payment sheets** run in the simulator through the [simulated device features](device-api.md). The emulator and Simulator lanes drive the native sheets.

Run parity on a build that is not being published: an over-the-air update applies mid-flow on the emulator, as designed, so start the run when no release is in flight.

## Run it yourself

1. Open the repository's **Actions** tab and pick `parity` (Android) or `parity-ios` (iOS).
2. Choose **Run workflow** and wait for the run to finish.
3. Open the run summary. It lists each screen with the actionable and text percentages shown above.

The workflows are `.github/workflows/parity.yml` and `.github/workflows/parity-ios.yml`. The drivers are in `apps/tide-and-tackle/sim/`.

## Next steps

- [Simulated device features](device-api.md): camera, location, payment, biometrics and notifications in the simulator.
- [Test with an assistant](test-with-an-assistant.md): point Claude, ChatGPT or Cursor at the simulator.
- [Testing](testing.md): typed tests that run on the simulator and, with `--device agent-device`, on an emulator or Simulator.
