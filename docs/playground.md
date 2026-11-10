# The Shipvo playground

The playground is for anyone who wants to see Shipvo work before installing it, founders and developers alike. You get a sample app on an Android phone and an iPhone in your browser, with panels for the main features. Open [shipvo.dev/playground](https://shipvo.dev/playground/). There is nothing to install, and it needs JavaScript on.

## What you see

The sample app is a small shop called Tide and Tackle. The bar above the phone has these controls:

| Control | What it does |
| --- | --- |
| **Android** / **iOS** | Switch the phone skin. The app is the same on both. |
| **Dark mode** | Shows the app in its dark theme. |
| **Large text** | Shows the app with larger text. |
| **Right to left** | Shows the app with right-to-left text. |

Pick a panel from the feature list to try one feature.

## The panels

1. **Signed updates.** Publish a signed update, stage it to 10% and then 100% of phones, crash it and watch the rollback. The signature result, cohort counts and crash-loop threshold come from the real signer, verifier, cohort bands and runtime code, recorded when the site was built. See [the CLI guide](cli.md) for the same steps on your app.
2. **Device API.** Set location, camera, biometrics, payment, notification and airplane mode, and see the sample app show each result. See [Device API](device-api.md).
3. **Agent tools.** The panel has a tool console and a **Watch Lumi** button.
   - In the console, pick a tool (`screen`, `tap`, `type` or `device_log`), fill in its arguments and press Run. The result appears as JSON below. Run `screen` first: it lists the labelled elements with refs such as `e1`. Then `tap` with `ref` set to `e1` adds the first product to the cart.
   - **Watch Lumi** runs [Lumi](lumi.md) on the sample app. It adds three items to the cart per run and shows a caption for each tap.
   - These are the same tools your assistant uses over MCP. See [Agents](agents.md).
4. **Many phones.** Shows 1 to 12 phones side by side. Set the number and choose Android, iOS or both. The page starts with 4 phones, Android and iOS together. Numbers outside 1 to 12 are moved to the nearest valid number.

## Share a setup with a link

Many phones reads its settings from the address, so you can send a setup to someone else. Press **Copy link** to copy the current one. You can also write it by hand:

```text
https://shipvo.dev/playground/?phones=6&mix=both&dark=1#many
```

| Parameter | Values | Default |
| --- | --- | --- |
| `phones` | A number from 1 to 12 | 4 |
| `mix` | `android`, `ios` or `both` | `both` |
| `dark`, `large`, `rtl` | `1` to turn on dark mode, large text or right-to-left text | off |

A number above 12 becomes 12 and a number below 1 becomes 1. Any other value for `phones` or `mix` falls back to the default, so a link never breaks the page. Other panels open from their own address: `#agent`, `#many`, and so on. `?platform=android` or `?platform=ios` picks the skin.

## Troubleshooting

- **A panel stays empty.** Reload the page. The phones load after the page, and each one takes a moment.
- **The tool console says an element is not found.** Run `screen` again. Refs are per screen, so a ref from before you changed screen may not exist now.
- **Lumi ran twice and the cart shows six items (three per run).** Reload the page for a fresh cart, then run it again.
- **Your link opens with a different number of phones.** Check that `phones` is between 1 and 12 and that `mix` is `android`, `ios` or `both`.

## Next steps

- Run the same app on your own machine: [Build your first app](getting-started.md).
- Run your own app on a phone in your browser: [Run on a phone](run.md).
- Let an assistant drive a phone: [Agents](agents.md).
