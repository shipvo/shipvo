# Simulator vs device parity

Can an agent trust the PureNative UI simulator? We ran the same purchase (2 × Chrome Spoon, Friday afternoon delivery, cash) on the simulator and on the real app, then compared what an agent can act on and read on every screen.

**Result: 97.2% actionable parity on Android and 100% on iOS. Both reached the same outcome.**

| Screen | Android: actionable | Android: text | iOS: actionable | iOS: text |
| --- | --- | --- | --- | --- |
| Home | 83% | 86% | 100% | 96% |
| Product | 100% | 100% | 100% | 94% |
| Added to cart | 100% | 100% | 100% | 94% |
| Cart | 100% | 96% | 100% | 96% |
| Checkout | 100% | 100% | 100% | 78% |
| Order placed | 100% | 100% | 100% | 82% |
| **Mean** | **97.2%** | **96.8%** | **100%** | **90.0%** |

- **Android:** release APK on an Android 11 emulator (Pixel 5 profile), GitHub Actions. Driven through Android's own accessibility tree (uiautomator over adb). "App isn't responding" dialogs: 0.
- **iOS:** Expo simulator build on an iPhone 17 simulator, GitHub macOS runner. Driven with Appium XCUITest. No Apple Developer account.
- **Simulator:** the app's React Native Web build in a phone-sized headless browser, showing the same live content as devices.

## Definitions

- **Actionable parity:** shared actionable elements (buttons, radio options, text fields; role and label) divided by all actionable elements seen on either side. Disabled controls count on both sides. Platform chrome (scroll indicators, keyboard keys) is excluded by the platform's own accessibility flags, not by name.
- **Text coverage:** the share of text the simulator shows that also appears on the device, exactly or contained in a longer label.

## Known differences

1. **Horizontal rails on Android:** items off-screen to the right of a horizontal carousel aren't in Android's accessibility tree until swiped. The simulator exposes the whole rail. An agent on a device needs a sideways swipe. That accounts for all of the Home gap (3 products).
2. **Text grouping on iOS:** iOS reads some rows as a single label (for example a delivery slot with its fee), where the web reads separate lines. The agent sees the same information, grouped differently. That accounts for most of the 78% on Checkout.
3. **Native-only features** (camera, push, payment sheets) aren't in the simulator. Flows that need them run on the emulator or device lanes.

## Not covered yet

- **Real phones in automation:** LambdaTest automation needs a paid plan on this account (real devices: "Real Mobile App Automation not allowed"; emulators: "Native App Automation Virtual not allowed"). Manual App Live works. The native driver also runs on any USB-connected Android phone.
- **More flows:** this is one purchase flow. The suite should grow with every template app.

How to reproduce: `.github/workflows/parity.yml` (Android) and `.github/workflows/parity-ios.yml` (iOS). Drivers: `apps/tide-and-tackle/sim/`.
