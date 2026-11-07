import { registerRootComponent } from "expo";
import { App } from "./src/App";
import { ChessStore } from "./src/store";
import { createElement } from "react";
import { linkToTop } from "./src/link";

// One game for the whole app. The typed actions are also reachable as `globalThis.chess`,
// so a test or an agent can call get_board, legal_moves and move(from, to) on the running app.
const store = new ChessStore();
(globalThis as { chess?: ChessStore }).chess = store;

// On the two-phones demo page, keep this phone's game in step with the other phone (see docs/demos/chess.md).
if (typeof window !== "undefined") linkToTop(store, window as never);

registerRootComponent(() => createElement(App, { store }));
