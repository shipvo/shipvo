import { describe, expect, it } from "vitest";
import { createActions } from "../src/actions.js";
import { createStore } from "../src/store.js";
import { boardView, moveList } from "../src/view.js";

function setup() {
  const store = createStore();
  return { store, actions: createActions(store) };
}

describe("typed actions on the shared store", () => {
  it("get_board labels all 64 squares", () => {
    const { actions } = setup();
    const b = actions.get_board();
    expect(b.squares).toHaveLength(64);
    expect(b.squares.find((q) => q.square === "g1")?.label).toBe("white knight on g1");
    expect(b.squares.find((q) => q.square === "e4")?.label).toBe("empty square e4");
    expect(b.turn).toBe("white");
  });

  it("a move through move() shows in the UI view and the move list", () => {
    const { store, actions } = setup();
    let notified = 0;
    store.subscribe(() => notified++);
    const r = actions.move({ from: "e2", to: "e4" });
    expect(r.ok).toBe(true);
    expect(notified).toBe(1);
    const ui = boardView(store.game);
    expect(ui.find((q) => q.name === "e4")?.label).toBe("white pawn on e4");
    expect(ui.find((q) => q.name === "e2")?.label).toBe("empty square e2");
    expect(moveList(store.game)).toEqual(["1. white pawn from e2 to e4"]);
    expect(actions.get_board().moves).toEqual(["1. white pawn from e2 to e4"]);
    expect(actions.get_board().turn).toBe("black");
  });

  it("a move made on the store (the UI path) shows in get_board", () => {
    const { store, actions } = setup();
    store.play("g1f3");
    expect(actions.get_board().squares.find((q) => q.square === "f3")?.label).toBe("white knight on f3");
  });

  it("legal_moves lists moves, optionally from one square", () => {
    const { actions } = setup();
    expect(actions.legal_moves()).toHaveLength(20);
    expect(actions.legal_moves({ from: "e2" }).map((m) => m.to).sort()).toEqual(["e3", "e4"]);
  });

  it("rejects illegal moves with a reason and leaves the game unchanged", () => {
    const { store, actions } = setup();
    const cases: [string, string, RegExp][] = [
      ["e2", "e5", /cannot move/],
      ["e4", "e5", /no piece/],
      ["e7", "e5", /black's turn|It is white's turn/],
      ["z9", "e5", /Bad square/],
    ];
    for (const [from, to, re] of cases) {
      const r = actions.move({ from, to });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(re);
    }
    expect(store.game.moves).toHaveLength(0);
    expect(store.version()).toBe(0);
  });

  it("asks for a promotion piece when one is needed", () => {
    const { store, actions } = setup();
    for (const m of ["a2a4", "b7b5", "a4b5", "a7a6", "b5a6", "c8b7", "a6b7", "g8f6"]) store.play(m);
    const r = actions.move({ from: "b7", to: "a8" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/promotion/);
    expect(actions.move({ from: "b7", to: "a8", promotion: "q" }).ok).toBe(true);
  });
});
