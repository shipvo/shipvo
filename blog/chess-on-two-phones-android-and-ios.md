---
title: Two phones, one chess game: Android and iOS in your browser
date: 2026-11-07
author: Shipvo team
order: 2
tags: Guides, Testing
seo_title: Chess on an Android and iOS phone in your browser
summary: Open one page and see an Android phone and an iPhone play chess against each other. How the demo is built, how to run it, and what CI checks on every change.
---

Open [shipvo.dev/demos/chess](https://shipvo.dev/demos/chess/) and you see two phones side by side. One is Android and plays white. One is iOS and plays black. Tap a piece, then a square. The move shows on the other phone, and the other side's clock starts.

Nothing is installed. Both phones run in your browser on Shipvo Phone. This post explains how the demo works and how to run it yourself.

## Why a chess game

A chess app is a good test of a phone simulator. The rules are strict, so a wrong move is easy to spot. The board has 64 buttons, so touch input gets a real workout. And it needs two players, which makes it a fair test of two phones that talk to each other.

The app is in the repository as `apps/chess`. It is an Expo app with a pure rules engine, a shared game store and one screen.

## Run the chess demo on two phones

From the repository root:

```bash
pnpm install
pnpm -r build
pnpm --filter chess demo
```

The command builds the web copy of the app if it is missing, starts the Android phone and the iOS phone, and opens the page. To watch a full game play itself:

```bash
pnpm --filter chess demo -- --autoplay
```

Use `--port <n>` to pick the page port and `--no-open` to print the address without opening a browser. The steps are also in the [chess demo docs](https://shipvo.dev/docs/demos/chess/).

## How the two phones stay in sync

Each phone runs its own copy of the app. The page that holds both phones keeps the games the same:

1. The app posts its move list to the page after every move.
2. The page sends the list to the other phone.
3. The other phone plays any moves it does not have yet.

Moves travel as short strings such as `e2e4`. The app accepts messages only from the page that holds it, so a stray frame cannot make a move. On a plain `shipvo run` page nothing sends messages, and the app is just a chess board.

Each side has a clock above its phone. The clock of the side to move runs. A move hands the clock to the other side. Checkmate or a draw stops both.

## Every square has a name

An assistant can only play a game it can read. In this app every square is a button with an accessibility label that says what is on it, such as "white knight on g1" or "empty square e4". A square you can move to adds ", legal move" to its label.

This is the same idea as in [accessibility is your test interface](https://shipvo.dev/blog/accessibility-is-your-test-interface/): the labels that help a screen reader also let an agent see the board.

The game also has three typed actions that the UI and the agent both use:

- `get_board` returns the position, whose turn it is, the status and the move list.
- `legal_moves` lists the moves for the side to play, or from one square.
- `move` plays a move and says why when it is refused.

Because the UI and the actions share one store, a move made by one shows up in the other. Connect an assistant through [MCP](https://shipvo.dev/docs/agents/) and it can read the board, pick a legal move and play it on the phone, the same way you do with your finger.

## What CI checks

The demo is part of `pnpm -r test`, so it is checked on every change. The page test, `apps/chess/test/demo.test.ts`, runs the same code as the command in Chromium. It checks that:

- A full game of 13 moves (Légal's mate) plays out on both phones. Both show "Checkmate, white wins", and the page shows "Game over after 13 moves".
- A move made by tapping on the Android phone appears on the iOS phone, and the black clock starts running.
- Both clocks show minutes and seconds, and they stop when the game ends.

Two more test files cover the rules and the relay. The rules engine is tested with perft counts, which count every legal move sequence to a set depth and compare the total with known values. From the start position the counts are 20 at depth 1, 400 at depth 2 and 8,902 at depth 3. I ran the engine, link and store tests for this post: 34 tests passed.

## Use it as a pattern for your own app

You do not need chess to use the idea. Any app with state shared across screens can follow the same shape:

1. Put the rules in plain code with no UI, and test them on their own. The chess engine has no React in it.
2. Keep one store that the screen and the typed actions both call.
3. Give every control an accessibility label that says what it is and what it will do.
4. Write one page-level test that drives the app the way a person does, on both platforms.

An app built this way is easy for people, test scripts and assistants to operate, because they all use the same labels and the same actions. The [testing guide](https://shipvo.dev/docs/testing/) shows how to write typed tests against labels like these.

## What this shows about Shipvo Phone

The same app runs as an Android phone and an iOS phone from one web build, with no emulator and no Xcode. That is the loop Shipvo is built around: your agent writes the app, runs it on a phone in your browser and tests it there. Later, [`shipvo store`](https://shipvo.dev/docs/store/) takes the app to Google Play and the App Store, and changes go out as signed over-the-air updates.

## Try it

- Play on the [live demo](https://shipvo.dev/demos/chess/).
- Put your own app on a phone with the [`shipvo run` tutorial](https://shipvo.dev/docs/tutorials/run-your-app-on-a-phone/).
- Read how [`shipvo run` shows your app in a browser](https://shipvo.dev/blog/see-your-react-native-app-on-a-phone-in-your-browser/).
