# Learn

Step-by-step tutorials for people who have never used a terminal. Each one ends with something that works. New words are explained once and collected in the [glossary](../glossary.md).

## Start

| Tutorial | You will | Time | Level |
| --- | --- | --- | --- |
| [Create your first app](first-app.md) | Create an app, open it on a simulated phone, change its words and check a release | a few minutes of commands, plus reading | Beginner |

## Sell

| Tutorial | You will | Time | Level |
| --- | --- | --- | --- |
| [Make a shop with your own products](your-own-shop.md) | Create a shop from the template, put in your products and prices, check the cart and run a practice release | about two minutes of commands, plus time to write your products | Beginner |
| [Get your 12 testers](get-your-12-testers.md) | Join Shipvo Testers, add the group to your Play closed test and share your opt-in link | about 15 minutes, then 14 days of waiting | Beginner |

Taking payments is not a tutorial yet: the shop template has no payment step.

## Run your app

| Tutorial | You will | Time | Level |
| --- | --- | --- | --- |
| [See your app on a phone in your browser](run-your-app-on-a-phone.md) | Start a simulated Android or iPhone with one command, tap through your app, see the system sheet and stop it | about 10 minutes | Beginner |

Letting your assistant drive this same phone is not a tutorial yet: attaching is not available yet.

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
