import { registerRootComponent } from "expo";
import { App } from "./src/App";
import { ChessStore } from "./src/store";
import { createElement } from "react";

// One game for the whole app. The typed actions are also reachable as `globalThis.chess`,
// so a test or an agent can call get_board, legal_moves and move(from, to) on the running app.
const store = new ChessStore();
(globalThis as { chess?: ChessStore }).chess = store;

registerRootComponent(() => createElement(App, { store }));
