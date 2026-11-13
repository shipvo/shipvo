# Learn

Step-by-step tutorials for people who have never used a terminal. Each one ends with something that works. New words are explained once and collected in the [glossary](../glossary.md).

## Start

| Tutorial | You will | Time | Level |
| --- | --- | --- | --- |
| [Try Shipvo in your browser](try-shipvo-in-your-browser.md) | Tap a shop on an Android phone and an iPhone, test dark mode, a location and a payment, watch a signed update roll back and share a wall of phones | about 15 minutes, nothing to install | Beginner |
| [Create your first app](first-app.md) | Create an app, open it on a simulated phone, change its words and check a release | a few minutes of commands, plus reading | Beginner |
| [Describe an app and watch it appear on a phone](describe-an-app.md) | Tell an assistant what app you want, see it on an Android and an iOS phone in your browser, ask for a change and see it update | a few minutes after setup | Beginner |

## Sell

| Tutorial | You will | Time | Level |
| --- | --- | --- | --- |
| [Make a shop with your own products](your-own-shop.md) | Create a shop from the template, put in your products and prices, check the cart and run a practice release | about two minutes of commands, plus time to write your products | Beginner |
| [Get your 12 testers](get-your-12-testers.md) | Join Shipvo Testers, add the group to your Play closed test and share your opt-in link | about 15 minutes, then 14 days of waiting | Beginner |

## Run your app

| Tutorial | You will | Time | Level |
| --- | --- | --- | --- |
| [Play chess on two phones](chess-on-two-phones.md) | Start an Android phone and an iPhone-style phone side by side, play a move on one and see it on the other, then watch a full game | about 15 minutes | Beginner |
| [Change your app and watch the phone update as you save](watch-your-app-update.md) | Change a product name and price, see the phone reload on each save, and fix a typo from a plain message | about 10 minutes | Beginner |
| [See your app on a phone in your browser](run-your-app-on-a-phone.md) | Start a simulated Android or iPhone with one command, tap through your app, see the system sheet and stop it | about 10 minutes | Beginner |

## Test

| Tutorial | You will | Time | Level |
| --- | --- | --- | --- |
| [Have an AI assistant test your shop before every release](test-with-an-assistant.md) | Connect Claude or Cursor to your shop, have it shop like a customer, turn its run into a test and run it before a practice release | about two minutes of commands, plus 20 minutes to set up your assistant | Beginner |
| [Have Lumi test your app while you watch](test-your-app-with-lumi.md) | Run one command, ask Lumi to test your app, read its findings and replay one | about 10 minutes | Beginner |

For ChatGPT and for apps that are already published, see [Test with an assistant](../test-with-an-assistant.md).

## Ship updates

| Tutorial | You will | Time | Level |
| --- | --- | --- | --- |
| [Ship a fix to your customers' phones, a few at first, and undo it](ship-a-fix.md) | Fix a price, send it to a small group, check it, send it to everyone and practise a rollback | about 25 minutes, including setup | Beginner |

For the full publish guide, see [Build your first app](../getting-started.md), step 5.

## For contributors: live phones

Put a live phone where the reader looks at the app. Keep the screenshot after it, for print and slow connections:

```html
<div data-shipvo-phone data-app="tide" data-release="latest" data-path="/" data-caption="Try it: add a product to the cart" data-fallback="/tutorials/first-app/home.png"></div>
```

- `data-release` is `latest` (read once from `releases.json`) or a number such as `28`.
- `data-fallback` is the screenshot shown if the release cannot load. Always set it.
- Use a blank line before and after the line. Write a short "Try it" caption that says what to tap.
- Details: `services/site/phone-embed.mjs` and `services/site/public/phone.js`.
