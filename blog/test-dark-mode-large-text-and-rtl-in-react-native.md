---
title: Test dark mode, large text and right-to-left in a React Native app
date: 2026-11-06
order: 1
author: Shipvo team
tags: Guides, Testing
seo_title: Test dark mode, large text and RTL in React Native
summary: Change dark mode, text size and language on a simulated phone with one tool call each, and see how your React Native app reacts. Real commands and output.
---

Most apps are tested in one setting: light mode, default text size, English. Your users do not live there. They run dark mode at night, set text to the largest size because they cannot read small print, and use Arabic, where the whole layout flips. Each of these breaks apps in ordinary ways: a white label on a white card, a button whose text is cut off, an arrow that points the wrong way.

This post shows how to test all three on Shipvo Phone, the simulated phone that your AI assistant drives. It takes one tool call per setting. Target reader: a developer or founder who wants to know "does my app still work in dark mode with large text?" without hunting through emulator menus.

## The settings, in one table

Shipvo Phone has a Settings screen, and your assistant can read and change it. There are six keys. Each one reaches your app through the same API it would use on a real phone.

| Key | Values | What your app sees |
| --- | --- | --- |
| `dark_mode` | `true`, `false` | `Appearance` |
| `font_size` | `small`, `default`, `large`, `largest` | `PixelRatio.getFontScale()` |
| `bold_text` | `true`, `false` | `AccessibilityInfo` |
| `reduce_motion` | `true`, `false` | `AccessibilityInfo` |
| `language` | `en`, `fr`, `ar` | `Intl` |
| `rtl` | `true`, `false` | `I18nManager` |

The same tools work on the Android phone and the iPhone skin, so one check covers Android and iOS. The full reference is in [the phone apps guide](/docs/phone-apps/).

## Step 1: read the current settings

Start a session and call `get_settings`. We ran the simulator's own settings code from this repository to capture the text an assistant receives:

```text
Settings
- switch dark_mode (Dark mode): off
- choice font_size (Font size): default
- switch bold_text (Bold text): off
- switch reduce_motion (Reduce motion): off
- choice language (Language): en
- switch rtl (Right-to-left layout): off
```

Each row is a switch or a choice, with a name an assistant can read. That matters: the Settings screen is part of the accessibility tree, so it can be used by tapping as well as by tool call. If you want the background on why this tree is the test interface, read [accessibility is your test interface](/blog/accessibility-is-your-test-interface/).

## Step 2: change one setting and look at the screen

```text
open_app tide                                   -> session "tide-abc"
set_setting { session, key: "dark_mode", value: true }
screen { session }
```

`set_setting` changes the simulated device. Your app's `useColorScheme()` now returns `dark`, and the browser page that renders the phone gets a dark `prefers-color-scheme`. Then `screen` returns the new accessibility snapshot, and a screenshot shows the colours. Compare against the light version and look for text that disappeared.

Do the same for text size:

```text
set_setting { session, key: "font_size", value: "largest" }
screen { session }
```

Now `PixelRatio.getFontScale()` returns the largest scale. Buttons with fixed heights and rows with fixed widths are the usual casualties. A screenshot makes them obvious, and the snapshot shows whether a label is still there.

## Step 3: right-to-left with one setting

Language and layout direction are linked. Setting `language` to `ar` turns `rtl` on. Setting it to `en` or `fr` turns it off. We checked this in the simulator's tests in `packages/sim/settings.test.mjs`:

```js
assert.deepEqual(settingPatch("language", "ar"), { language: "ar", rtl: true });
assert.deepEqual(settingPatch("language", "fr"), { language: "fr", rtl: false });
```

So one call gives your app both a new language and `I18nManager.isRTL === true`:

```text
set_setting { session, key: "language", value: "ar" }
screen { session }
```

French is in the list for a different reason: it is a good test of long words. Strings run longer in French than in English, and that is where truncated labels show up.

## What a wrong call looks like

The tools return typed errors, so an assistant does not guess. We called the real code with a key and a value that do not exist:

```text
unknown_setting  unknown setting 'volume'. Settings: dark_mode, font_size, bold_text, reduce_motion, language, rtl
bad_value        'font_size' takes one of: small, default, large, largest
```

The message lists the valid options, so the next call is right. Every successful change is also written to `device_log` as a `setting` entry labelled `simulated: true`, so a test can assert that the setting was applied.

## Step 4: do it all with a plain sentence

You do not have to write tool calls. If your assistant is connected to Shipvo over MCP, you can write:

> Does the shop still work in dark mode with large text? Then try it in Arabic.

The assistant opens the app, sets `dark_mode` and `font_size`, buys something, then sets `language` to `ar` and does it again. If you are new to this, [test your app with an assistant](/docs/test-with-an-assistant/) shows the setup, and [your assistant can test your app](/blog/your-assistant-can-test-your-app/) explains the idea for founders.

## Start every run from the same phone

For repeatable checks, put the starting state in a `phone.json` next to where the simulator starts:

```json
{
  "current_app": "tide",
  "settings": { "dark_mode": true, "font_size": "large" }
}
```

`settings` takes the same keys as `set_setting`. The same file gives the same phone on every run, so a test that passes today fails tomorrow only when your app changed. An invalid file fails the session with `bad_profile` and says why.

## Turn it into a test that stays

Once a check works by hand, keep it. Your assistant can export what it did as a typed test with `export_test`, and `shipvo test` runs it in CI. See [testing](/docs/testing/) for the format, and [the bug our first typed test found](/blog/the-bug-our-first-typed-test-found/) for what that looks like in practice.

## How close is the simulated phone to a real one?

Settings reach your app through the same React Native APIs, but the useful question is whether the simulator behaves like the Android emulator and the iOS Simulator. Shipvo publishes that comparison: 100% actionable parity on both Android and iOS across 13 screens of the sample shop, with text coverage of 98.6% on Android and 96.2% on iOS. The numbers, bar and method are in [parity results](/docs/parity-results/).

## Try it

1. Run `npx shipvo run android` or `npx shipvo run ios` and watch the phone in your browser ([see how](/blog/see-your-react-native-app-on-a-phone-in-your-browser/)).
2. Ask your assistant to set `dark_mode`, `font_size` and `language` and report what changed.
3. Read [the phone apps guide](/docs/phone-apps/) for the Browser, Store and system controls.

Same phone, another app: [Test the links that leave your app](/blog/test-links-that-leave-your-app/) uses the Browser to check web pages and deep links.
