# Playground: try Shipvo in your browser

For anyone who wants to see Shipvo work before installing anything. You will open a sample app on an Android phone and an iPhone in your browser, change how the phones look, try device features, watch a signed update roll out and roll back, and share a setup with a link.

Founders: this is the fastest way to see what Shipvo does. You need a browser and nothing else.

## Open it

1. Go to [shipvo.dev/playground](https://shipvo.dev/playground/).
2. Wait for the phone to show a shop called Tide and Tackle with three products.
3. Tap **Add** next to a product. The line "Cart: 1 item" changes.

You will see a phone with the sample app inside. If the phone stays blank, reload the page. The page needs JavaScript on.

## Change how the phone looks

The bar above the phone has these controls:

| Control | What it does |
| --- | --- |
| Android / iOS | Switches the phone between the Android look and the iPhone look. |
| Dark mode | Turns on dark colours in the app. |
| Large text | Makes the app's text bigger, as a person with a larger text setting would see it. |
| Right to left | Flips the layout for right-to-left languages. |

Use these to check that an app still reads well. The same checks run on your own app with an assistant: see [Phone Browser, Settings and system controls](phone-apps.md).

## Try the features in the sidebar

| Entry | What you can do | Learn more |
| --- | --- | --- |
| Sample app | Use the shop on Android or iOS. | [Build your first app](getting-started.md) |
| Signed updates | Publish a signed update, stage it to 10% and then 100% of phones, crash it and watch the rollback. The signature result, cohort counts and crash-loop threshold come from the real signer, verifier, cohort bands and runtime code, recorded when the site was built. | [CLI guide](cli.md) |
| Device API | Set location, camera, biometrics, payment, notification and airplane mode, and see the app show each result. | [Device API](device-api.md) |
| Agent tools | See how an assistant reads the screen as labelled elements and taps, types and scrolls over MCP. | [Agents and Shipvo apps](agents.md) |
| Many phones | Show 1 to 12 Android and iOS phones side by side. | [Simulators](https://shipvo.dev/products/simulators/) |

## Show many phones and share the setup

1. Open **Many phones**.
2. Pick the number of phones, from 1 to 12.
3. Choose Android, iOS or both.
4. Turn on dark mode if you want it on every phone.
5. Select **Copy link** and send the link. Whoever opens it sees your setup.

You can also write the link yourself:

```text
https://shipvo.dev/playground/?phones=6&mix=both&dark=1#many
```

| Parameter | Values | Default |
| --- | --- | --- |
| `phones` | A number from 1 to 12. Larger numbers give 12, zero or less gives 1, and anything that is not a number gives 4. | 4 |
| `mix` | `android`, `ios` or `both`. Any other value gives `both`. | `both` |
| `dark` | `1` turns on dark mode on every phone. | Off |
| `#many` | Opens the Many phones entry. | |

## Troubleshooting

**The phone is blank or a panel does not load.** Reload the page and check that JavaScript is on. Browser extensions that block scripts can stop the phone frame from starting.

**My link opens one phone, not the number I set.** Check that the link kept the part after `?`. Some chat apps cut it. Use **Copy link** and paste it as plain text.

**I typed `mix=iphone` and got both platforms.** `mix` takes `android`, `ios` or `both`. Anything else gives `both`.

**I want this with my own app.** The playground runs a fixed sample app. To see your app on a phone in your browser, use [`shipvo run`](run.md).

## Next steps

- Build your own app in twenty minutes: [Build your first app](getting-started.md).
- Run your app on a phone in your browser: [Run on a phone](run.md).
- Let an assistant describe an app and see it appear on the phone: [Describe an app and it appears](phone-apps.md#describe-an-app-and-it-appears).
- Terms used here: [Glossary](glossary.md).
