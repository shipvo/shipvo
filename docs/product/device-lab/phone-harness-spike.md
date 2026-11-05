# Phone Harness spike (first slice of #110)

Date: 2026-11-05. Script: [`scripts/android-e2e/phone-harness-spike.py`](../../../scripts/android-e2e/phone-harness-spike.py). Log of all 3 runs: [`phone-harness-spike.json`](phone-harness-spike.json).

Question: if an agent drives the sample app with [Phone Harness](https://github.com/ShawnPana/phone-harness) (MIT), does it see what our simulator shows, and is a full parity lane worth building?

## What I ran

- Android 11 (API 30) emulator, 1080x2340, the device-lab test build of the sample shell (OTA release 15).
- Phone Harness 0.3.3, installed with `pip` from git in a venv. No account, no cloud. It talks to the emulator through `adb`.
- The simulator (`@shipvo/sim`, headless Chromium) on the same host.
- One purchase, the same as flow A in `docs/parity-results.md`: browse, 2 x Chrome Spoon, Friday 14:00 delivery, type an address, cash on delivery, place order. Same steps on both sides, by visible label.
- 3 runs. Medians below.

## Results

| Measure | Result |
| --- | --- |
| Purchase completed (order screen with "Share order") | device 3 of 3, simulator 3 of 3 |
| Launch to home screen readable on the device | 1,699 to 2,048 ms (median 1,790 ms) |
| One `screen()` read on the device | about 1,550 to 1,610 ms per call (6 screens, 3 runs) |
| One screen read on the simulator | about 160 ms |
| Tap on the device (`adb input tap`) | 504 to 569 ms per tap; typing the address step 5,160 ms |
| Tap on the simulator | 492 to 529 ms per step |
| Whole flow, device: find + tap + wait for next screen | 43.5 s, 42.7 s, 42.5 s (runs 1 to 3) |
| Whole flow, simulator: act only | 4.1 s in each run |

Most of the device time is in `screen()`. Every "find the element" and "wait for the next screen" is one or more reads at about 1.6 s each. "Place order" took 9.8 s to find because it is below the fold and the script scrolled to it.

### What it reads, against the simulator

Count of the labels Phone Harness reads on each screen, and how many of them are also in the simulator's tree for the same screen (median of 3):

| Screen | Device labels | Also in simulator | Not in simulator |
| --- | --- | --- | --- |
| Home | 47 | 28 | 19 |
| Product | 20 | 13 | 7 |
| Added to cart | 22 | 15 | 7 |
| Cart | 27 | 17 | 10 |
| Checkout | 32 | 19 | 13 |
| Order placed | 14 | 11 | 3 |
| **All** | 162 | 103 (64%) | 59 |

The labels that do not match, from the lists in the log:

- Most are the text children of a button that is already matched. Android exposes both the button's description and the text inside it ("Scan a product barcode" and "Scan", "Open cart, 2 items" and "Cart (2)", "Friday 14:00-18:00, 1 500 FCFA" and "Friday · 14:00-18:00", "1 500 FCFA"). The simulator lists only the button. This is how Android's tree works, not an app fault.
- The stepper shows "+", "−" and the number as separate nodes.
- One real difference: the address field is "Delivery address, e.g. Bonapriso, Douala" on the device (the hint is part of the label) and "Delivery address" in the simulator. The first version of the script failed on this.

I did not score it the other way (simulator labels missing on the device). The simulator lists the whole page, and the phone lists only what is on screen plus some off-screen nodes.

### Things I saw that matter for an agent

- `screen()` returns off-screen nodes too, with `x=0, y=0` (for example "Cash on delivery" and "Mobile money" on the checkout screen). A script that taps the first match without checking the position taps the corner of the screen. The spike script skips boxes at 0,0.
- Phone Harness sends usage events to PostHog by default, and the event includes the script text. It is off with `phone-harness config set telemetry false` or `DO_NOT_TRACK=1`. I turned it off after the first 3 invocations (`config set platform android`, `doctor android` and one script that printed the home screen). All later runs had it off.

## What this does and does not show

- Phone Harness reads Android's accessibility tree over adb, like our own driver (`apps/tide-and-tackle/sim/native.mjs`, uiautomator). So this checks the driver, not a different source of truth. I did not compare its output with `native.mjs` for the same screens, so I make no claim about how they differ.
- One flow on one emulator, 3 runs. The system permission dialogs (camera, location) and the payment sheet (flow C) were not driven.
- The sample app on the device was an OTA release from the local release server, not the same release the simulator showed ("release 26" in the simulator's response). Screens matched by label, not by release.

## Recommendation

Do not build a separate Phone Harness parity lane now.

- It adds no new source of truth: it reads the same accessibility tree that our parity harness reads.
- It is about 10 times slower per read (1.6 s against 160 ms), so a full flow takes about 43 s of reading and tapping.
- It does complete the purchase on the emulator, 3 of 3. Keep the script as an optional smoke check of "an off-the-shelf driver can finish a purchase", run by hand or from the Device Lab.

What would change this: if we want a check that reads the screen by a different route (for example screenshots and OCR), that is a different spike.

Left for a later slice: flow C (permission dialogs), and a side-by-side with `native.mjs` output.
