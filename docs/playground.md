# The playground

This page is for anyone who wants to try Shipvo before installing it. You will use a sample app on an Android phone and an iPhone in your browser, with no account and nothing to install. The playground is at [shipvo.dev/playground](https://shipvo.dev/playground/).

## What you see

A small shop app, Tide and Tackle, runs on a simulated phone. The bar above the phone has:

- **Android** and **iOS**: switch the phone. The app is the same on both.
- **Dark mode**, **Large text** and **Right to left**: turn each on to see how the app looks for people who use those settings.

The sidebar opens one panel at a time. Each panel has its own link, so you can share it: `https://shipvo.dev/playground/#ota`, `#device`, `#agent` or `#many`.

## The panels

| Panel | What you do | Learn more |
| --- | --- | --- |
| Sample app | Look around. Tap the buttons in the app. | [Build your first app](getting-started.md) |
| Signed updates | Publish a signed update, stage it to 10% and then 100% of phones, crash it and watch the rollback. | [Publish over the air](getting-started.md#5-publish-over-the-air) |
| Device API | Set location, camera, biometrics, payment, notification and airplane mode. The app shows each result. | [Device API](device-api.md) |
| Agent tools | Run the tools an assistant uses, or watch Lumi use the app. | [Agents](agents.md) |
| Many phones | Show 1 to 12 phones side by side. | [Simulators](https://shipvo.dev/products/simulators/) |

## Run an agent tool

1. Open [shipvo.dev/playground/#agent](https://shipvo.dev/playground/#agent).
2. Pick `screen` and press **Run tool**. You see the screen as a list of labelled elements, each with a `ref` such as `e1`.
3. Pick `tap`, keep `e1` or type another `ref` from the list, and press **Run tool**. The phone reacts.
4. Pick `type`, set a `ref` for a text field and some text, and press **Run tool**.
5. Pick `device_log` to see what the app reported. The result appears in the result box, as it does for every tool.

The console offers `screen`, `tap`, `type` and `device_log`. They take the same arguments and return the same shapes as the MCP tools in [Agents](agents.md).

Press **Watch Lumi** to see Lumi read the screen and tap three Add buttons. Captions appear under the button as each step happens. The run works on Android and iOS. Read more in [Lumi on Shipvo Phone](lumi.md).

## Many phones

Open the **Many phones** panel and set:

- **Phones**: a whole number from 1 to 12. The default is 4.
- **Mix**: `both` (Android and iOS alternate), `android` or `ios`.

**Copy link** copies a link to your current setup. You can also write the link yourself:

```text
https://shipvo.dev/playground/?phones=6&mix=both&dark=1#many
```

| Parameter | Values | Default |
| --- | --- | --- |
| `phones` | 1 to 12. Larger numbers become 12. Zero or below becomes 1. Text that is not a number gives 4. | 4 |
| `mix` | `both`, `android`, `ios`. Anything else gives `both`. | `both` |
| `dark` | `1` for dark mode. | off |

## Troubleshooting

- **The phone is blank or a panel does not load.** The playground needs JavaScript. Turn it on and reload the page.
- **Run tool says `timeout`.** The phone did not answer within 15 seconds. Reload the page and try again.
- **`tap` does nothing.** The `ref` comes from the last `screen` result and changes when the screen changes. Run `screen` again and use the new `ref`.
- **Nothing happens when you press Copy link.** Your browser blocked clipboard access. Copy the address from the bar instead; it has the same settings.
- **I want this on my own app.** Run `shipvo run android` or `shipvo run ios` in your app folder ([Run on a phone](run.md)).

## Next steps

- [Build your first app](getting-started.md)
- [Test with an assistant](test-with-an-assistant.md)
- [Run on a phone in your browser](run.md)
