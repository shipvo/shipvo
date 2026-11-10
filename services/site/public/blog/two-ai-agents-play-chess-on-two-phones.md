# Two AI agents play chess on two phones, Android and iOS, through MCP

> An Android phone and an iOS phone in your browser, one AI agent on each, playing a full game through MCP. How it works, the commands, and what CI measures.

By Shipvo team, 2026-11-10. Canonical: https://shipvo.dev/blog/two-ai-agents-play-chess-on-two-phones/

Most demos of AI agents on mobile apps show one agent and one screen. We wanted two agents, two phones, one shared game, and rules the app enforces. So we built chess.

An Android phone plays white. An iOS phone plays black. Both run the same chess app, side by side in a browser tab, and a move on one shows on the other. You can watch it at [shipvo.dev/demos/chess](https://shipvo.dev/demos/chess/) with nothing to install, and press "Play against it" to take white yourself.

This post explains how two coding agents play a full game through MCP, the commands to run it, and what our tests measure.

## How AI agents play chess on a phone through MCP

[MCP](https://shipvo.dev/blog/what-mcp-is-and-why-your-app-might-speak-it/) is the protocol that lets an agent call tools. Shipvo's MCP server, `@shipvo/mcp`, gives an agent a phone it can see and tap. The agent does not get pixels to guess at. It gets the app's accessibility tree: every control has a name.

That is why chess works well here. The board is 64 labelled squares, such as "white pawn on f2". The agent reads the board with `get_board`, which is the screen tool. It lists the squares, says whose turn it is and shows the last move. To move, the agent taps one of its pieces. The app marks every square that piece can reach as "legal move", and the agent taps one of those. The same pattern is why [accessibility is your test interface](https://shipvo.dev/blog/accessibility-is-your-test-interface/): a well-labelled app is one an agent can use.

The agent never gets a move API that bypasses the screen. It plays through the same taps a person would make.

## Run two agents on two phones

From the repository root, after `pnpm install` and `pnpm -r build`:

```bash
pnpm --filter chess demo -- --agents
```

The command starts the Android phone (white) and the iOS phone (black) as live runs. For each side it prints an MCP config and a prompt to give that agent. The config starts `@shipvo/mcp` in the folder of that phone, so each agent attaches to the right one.

Add each config to an assistant, for example Claude on one side and ChatGPT on the other. Any agent that runs stdio MCP works, local or hosted. White's prompt starts like this:

> You play white in session white. Call open_app with app "chess" and session "white". Read the board with get_board ...

When both agents are connected, press "Start the clock" on the page. Each side has a move timer, 60 seconds by default. Change it with `--move-time <seconds>`.

To save the game, add `--record`:

```bash
pnpm --filter chess demo -- --agents --record
```

It records the page as one video: both phones, both clocks, the agent names and the move list. When the game ends it prints the path of the video and of `game.pgn`, the standard move file that any chess tool can open. The [record guide](https://shipvo.dev/docs/record/) covers the recorder.

## The app enforces the rules, not the agents

An agent that is told "wait for your turn" can still try to move out of turn. So the app does not trust it. If black taps a piece first, the screen says:

```text
It is white's turn. You play black. Wait for your turn, then call get_board again.
```

Nothing moves. The same happens to white after white's move. The game ends on checkmate, stalemate, a draw rule, or a move that takes longer than the move time, and the page shows the result.

This is the part worth copying for your own app. When an agent tests a flow, the app should refuse wrong actions in plain words on screen. The agent reads the refusal and recovers, and you can write a test for it.

## What CI measures

We do not ask you to take the demo on trust. These checks run as part of `pnpm -r test`. We ran the chess tests in [`apps/chess/test/`](https://github.com/shipvo/shipvo/tree/main/apps/chess/test) on this branch today: 31 passed across the engine, the move relay and the agent test.

- **Move generation is checked against known counts.** The engine reproduces the standard perft numbers from the start position: 20, 400 and 8,902 moves at depths 1, 2 and 3. Castling, en passant, promotion, pins, stalemate and the repetition and 50-move rules each have a test. See `apps/chess/test/engine.test.ts`.
- **Two scripted MCP clients play fool's mate** (1. f3 e5 2. g4 Qh4#), with no AI involved. Each attaches to its phone with `open_app`. The test checks that black's early move is refused, that white's second move in a row is refused, that both phones show "Checkmate, black wins", and that the move file ends with `1. f3 e5 2. g4 Qh4# 0-1`. See `apps/chess/test/agents.test.ts`.
- **A side that takes too long loses.** With a 1.5 second move time, the page shows "Time out, black wins" and the move file records a time forfeit.
- **A full 13-move game plays in Chromium.** `apps/chess/test/demo.test.ts` plays Légal's mate on both phones and checks that both phones show the same final position and the same result: "Checkmate, white wins" after 13 moves.

The point of the scripted version is that the plumbing is tested without a language model. When a real pair of agents plays, any trouble is in their play, not in the phones.

## Why chess is a good test for your own agent setup

Chess is a small stand-in for most real app flows:

- **Two sessions at once.** A marketplace has a buyer and a seller. A chat app has two people. The `session` name in `open_app` lets one agent drive each.
- **State that crosses devices.** A move on one phone must show on the other. That is the same shape as a delivery update or a message.
- **Waiting.** An agent must wait for its turn instead of sleeping for a guessed time. Our post on [waiting instead of sleeping](https://shipvo.dev/blog/wait-do-not-sleep/) shows the tools for that.
- **Refusals.** Real apps say no. Agents should read it and carry on.

If you can get two agents through a game here, you can get one agent through your checkout.

## Try it

1. Watch or play: [shipvo.dev/demos/chess](https://shipvo.dev/demos/chess/).
2. Run it yourself, step by step, in the tutorial: [play chess on two phones](https://shipvo.dev/learn/chess-on-two-phones/).
3. Read the options and troubleshooting in the [chess demo docs](https://shipvo.dev/docs/demo-chess/).
4. Point an agent at your own app with [Shipvo Phone in your browser](https://shipvo.dev/blog/see-your-react-native-app-on-a-phone-in-your-browser/) and [your assistant tests your app](https://shipvo.dev/blog/your-assistant-can-test-your-app/).

Android and iOS run in the same browser tab, from the same code, with the same test.
