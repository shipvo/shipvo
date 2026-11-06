# Check your shop in dark mode, with big text and in Arabic

You will ask an AI assistant to switch a simulated phone into dark mode, to the largest text size and to Arabic, and to tell you what happens to your shop. Then you will have it fix what it finds. You need no real phone and you write no code.

**Level:** beginner. **Time:** about 30 minutes, most of it setting up your assistant the first time. On our test machine the three setting changes and screenshots took about 10 seconds (see "What we measured").

New words are explained once, and collected in the [glossary](../glossary.md).

## What you need

- The shop from [Make a shop with your own products](your-own-shop.md), and an assistant connected to it, as set up in [Have an AI assistant test your shop](test-with-an-assistant.md), steps 1 and 2. This page starts from there. The folder is called `sandbar` here; use your own name.
- The simulator running (`npm run sim` in the `sandbar` folder) and the assistant restarted so it sees the Shipvo tools.

Why check these three things? Many people use their phone in dark mode, with bigger text, or in a language that is read right to left, such as Arabic. A shop that looks wrong for them loses sales. The simulated phone can switch each of these on demand, so you do not hunt through phone menus.

## 1. See what your shop does today

Type this to your assistant:

```text
Open the Shipvo app "sandbar". Take a screenshot. Then turn on dark mode and take another screenshot. Tell me if they differ.
```

The assistant uses the **Settings** of the simulated phone. It reads the settings, then changes one (`set_setting`). Every change is recorded in the phone's log (`device_log`) as a `setting` entry with `simulated: true`, so you can tell it from a real phone change.

You should hear that dark mode is now on, and that the two screenshots are the same. The starter shop has fixed light colours. It does not look at the phone's setting. That is the first thing to fix.

![The Sandbar Shop list with a pale background and five products, shown while the phone is in dark mode.](/tutorials/check-dark-mode-text-size-arabic/01-before.png)

> **If something goes wrong.** The assistant says it has no Shipvo tools, or cannot reach the simulator: see the "If something goes wrong" box in step 2 of [the assistant tutorial](test-with-an-assistant.md). If it says the app is not found, ask it to run `list_apps` and use the name it prints.

## 2. Try Arabic

```text
Set the phone language to Arabic and take a screenshot. What changed?
```

Setting the language to Arabic also turns on **right-to-left** layout: lines start on the right, like Arabic writing. You should hear that the phone now shows the setting "Right-to-left layout: on", and the screenshot shows each product row flipped: the price on the left and the name on the right, and the title and Cart link swapped.

![The same shop list with the layout flipped. The title Sandbar Shop is on the right and the Cart link on the left. In each row the product name is on the right and the price on the left.](/tutorials/check-dark-mode-text-size-arabic/02-arabic.png)

The product list already flips. The words are still in English, because they come from your own product file, not from a translation. Other screens, such as the cart, may not flip yet: step 3 fixes that. Ask your assistant to switch back with `language` set to `en`.

> **If something goes wrong.** The assistant says `bad_value`: the phone knows three languages, `en`, `fr` and `ar`. It says `unknown_setting`: the setting does not exist. It lists the valid ones, which are dark mode, font size, bold text, reduce motion, language and right-to-left.

## 3. Fix dark mode, text size and right-to-left

Type this:

```text
My shop ignores the phone's dark mode, text size and language direction. Make every screen follow all three: dark colours when the phone is in dark mode, text that grows with the text size setting, and right-to-left layout, where every heading, label and total starts on the right. Keep the same layout. Then check it in the simulator.
```

On our run, the assistant added one small file with a light and a dark set of colours, and used it in the three screens. It took the assistant a few minutes. The simulator rebuilds your app when you restart it, so stop `npm run sim` with Ctrl+C, run it again and wait for the "Simulator on" line.

Now ask:

```text
Turn on dark mode, open the Wool beanie, add it to the cart, open the cart and take a screenshot.
```

You should see a dark teal page with light text, a light blue **Pay** button and a **Total: $24.00** line.

![The shop cart in dark mode. A dark teal page. Back and Remove are light blue links. Wool beanie x 1 and Total: $24.00 are in near-white text. A wide light blue Pay button sits under the total.](/tutorials/check-dark-mode-text-size-arabic/03-dark.png)

> **If something goes wrong.** The screen is still light: the simulator was not restarted, so it is showing the old app. Restart it as above. The assistant says it cannot find the screen after you restarted the simulator: ask it to open the app again. Old sessions end when the simulator stops.

## 4. Try the largest text, together with dark mode

```text
Set the font size to largest and take a screenshot of the cart. Is anything cut off or overlapping?
```

The largest text size makes text 1.3 times as big. You should see "Total: $24.00" clearly bigger, with all words still on screen and the Pay button still wide.

![The cart in dark mode with the largest text. The words Cart, Wool beanie x 1 and Total: $24.00 are larger than before, nothing is cut off, and the Pay button is under the total.](/tutorials/check-dark-mode-text-size-arabic/04-cart-dark-largest.png)

## 5. Both at once, in Arabic

```text
Set the language to Arabic and take a screenshot of the cart. Does everything still make sense?
```

You should see the whole cart flipped: **Back**, the **Cart** heading and the **Total** line on the right, the product name on the right and **Remove** on the left, in dark colours and large text.

This is the kind of detail a person who reads Arabic notices at once, and it is why the step 3 prompt asks for right-to-left layout on every screen.

## 6. Keep the check

Ask: "Turn what you just did into a test I can run before every release." The assistant uses `export_test`, as in [the assistant tutorial](test-with-an-assistant.md#5-turn-the-run-into-a-test), so dark mode and big text stay checked each time.

## Recap

You switched a simulated phone to dark mode, the largest text size and Arabic with plain sentences, found that your starter shop ignored dark mode and text size, had it fixed, and checked the result in screenshots. Nothing was sent to your customers.

## What we measured

On 2026-11-06, on a GitHub Actions Linux runner with Node 22.23, a new shop app from this branch, driven over MCP: opening the app, three setting changes and four screenshots ran in about 10 seconds ([run log](https://github.com/shipvo/shipvo/actions/runs/42299243779)). Before the fix, the dark mode and largest text screenshots were byte-for-byte the same size as the light one, 77,025 bytes. After the fix, the dark cart screenshot is a different size from the light one. The screenshots here come from that run. The pictures are 1081 by 2340 pixels.

## Next steps

- [The simulated phone: Browser, Settings and system controls](../phone-apps.md): every setting, the Browser and the Store.
- [Have an AI assistant test your shop before every release](test-with-an-assistant.md)
- [Ship a fix to your customers' phones](ship-a-fix.md): send your dark mode fix to a few phones first.
