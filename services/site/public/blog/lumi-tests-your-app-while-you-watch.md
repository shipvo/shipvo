# Lumi tests your app while you watch, with one command

> npx shipvo lumi opens your app on an Android or iOS phone in your browser, taps through it and lists the problems it finds, each with a Replay button. What it found in our benchmark apps, and how to run it on yours.

By Hans Ade, 2026-11-07. Canonical: https://shipvo.dev/blog/lumi-tests-your-app-while-you-watch/

You made an app. Does every button work?

Run this in your app folder:

```bash
npx shipvo lumi
```

Shipvo builds a web copy of your app and opens it on a phone in your browser. Use `npx shipvo lumi ios` for an iPhone-style phone. Lumi is a small glowing orb beside the camera. Type `test my app` and it taps through your app.

![Lumi running on Tide & Tackle: the phone on the left, the sidebar on the right with a list of taps, three findings with Replay buttons, and coverage of 13 screens and 22 of 42 controls.](https://shipvo.dev/tutorials/test-your-app-with-lumi/findings.png)

![The same Lumi view on a 390 pixel wide window, with the sidebar below the phone.](https://shipvo.dev/tutorials/test-your-app-with-lumi/findings-phone.png)

## What Lumi finds

Each problem is a finding in the sidebar:

- a button that does nothing,
- a screen that stays blank,
- a network call that fails,
- a form that accepts input it should refuse.

A caption names every step, such as "Tapping Checkout". Press **Replay** on a finding and the phone repeats the steps that led to it.

## What we measured

We keep two apps in the repository with bugs planted on purpose, and a script that counts how many Lumi finds. With seed 1 and a budget of 200 steps, Lumi found 3 of 3 planted bugs in `shop` and 3 of 3 in `account`. It reached 5 screens in `shop` and 8 in `account`. The apps, the rules and the command to repeat the run are in the [Lumi benchmark](https://shipvo.dev/docs/lumi-bench/).

## Ask in plain words

Commands are plain text and need no AI account:

| Type | Lumi does |
| --- | --- |
| `test my app` | Walks the app from the start screen. |
| `test checkout` | Finds the path through Cart and Pay and says which one it picked. |
| `try checkout with bad input` | Runs the same path with invalid values. |
| `replay bug 2` | Plays finding number 2 again. |

A run repeats when you pass the same `--seed`, so you can check that your fix worked.

Lumi runs on your computer and answers only requests from its own page.

## Try it

Follow the [tutorial](https://shipvo.dev/docs/tutorials/test-your-app-with-lumi/) or read the [docs](https://shipvo.dev/docs/lumi/).
