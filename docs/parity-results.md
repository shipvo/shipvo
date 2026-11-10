# Simulator vs device parity

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

## What the text numbers mean

1. **Text grouping on iOS:** iOS reads some rows as a single label where the web reads separate lines. The agent sees the same information, grouped differently. This accounts for the text figure on "Order placed" (89%).
2. **On-screen keyboards** exist on devices. Fields behave the same, and the device drivers dismiss the keyboard when needed.
3. **Camera, push and payment sheets** run on the emulator and device lanes, which is where the parity flows exercise them.

## Reproduce it

The runs are `.github/workflows/parity.yml` (Android emulator) and `.github/workflows/parity-ios.yml` (iOS Simulator). The drivers are in `apps/tide-and-tackle/sim/`. Run parity on its own: an over-the-air publish during a run applies the update mid-flow, as designed, and that run is not comparable.

## Troubleshooting

| You see | Why | Do this |
| --- | --- | --- |
| A run's numbers differ from this page | A screen changed in the sample app, or an update was published during the run | Re-run when no publish is in progress, and compare the per-screen table |
| One screen is below 100% actionable | An element has a different role or label on one side | Open that screen in the simulator and on the emulator or Simulator and compare the two element lists |
| Text coverage is lower on iOS than on Android | iOS groups some rows into one label | Compare the full text of the screen; the same information is present |

## Next steps

- [Agent simulator over MCP](agents.md): drive the simulator the way the parity runs do.
- [Typed tests](testing.md): run the same test on the simulator and on a device.
- [Check every pull request](ci-check.md): put a parity-style check on each pull request.
