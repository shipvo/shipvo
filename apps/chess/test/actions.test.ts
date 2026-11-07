import { describe, expect, it } from "vitest";
import { createActions } from "../src/actions.js";
import { Game, parseFen } from "../src/engine.js";
import { createStore } from "../src/store.js";
import { boardView, moveList } from "../src/view.js";
import { initialPress, playMove, pressSquare, type PressState } from "../src/press.js";

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

  it("legal_moves lists four promotions for a promoting target", () => {
    const { store, actions } = setup();
    for (const m of ["a2a4", "b7b5", "a4b5", "a7a6", "b5a6", "c8b7", "a6b7", "g8f6"]) store.play(m);
    const promos = actions.legal_moves({ from: "b7" }).filter((m) => m.to === "a8");
    expect(promos.map((m) => m.promotion).sort()).toEqual(["b", "n", "q", "r"]);
  });

  it("legal_moves returns nothing for a bad square", () => {
    const { actions } = setup();
    expect(actions.legal_moves({ from: "z9" })).toEqual([]);
  });

  it("move after the game is over is refused", () => {
    const { store, actions } = setup();
    for (const m of ["f2f3", "e7e5", "g2g4", "d8h4"]) store.play(m);
    expect(actions.get_board().status).toMatch(/checkmate/);
    const r = actions.move({ from: "a2", to: "a3" });
    expect(r).toEqual({ ok: false, reason: "The game is over." });
  });

  it("move works when destructured from the actions object", () => {
    const { actions } = setup();
    const { move } = actions;
    expect(move({ from: "e2", to: "e4" }).ok).toBe(true);
  });
});

function promoSetup() {
  const real = createStore();
  const game = new Game(parseFen("8/P6k/8/8/8/8/8/K7 w - - 0 1"));
  const store = { ...real, game, play: (m: Parameters<typeof game.play>[0]) => game.play(m) };
  return { store, actions: createActions(store) };
}

describe("tap flow (pressSquare)", () => {
  const tap = (a: ReturnType<typeof createActions>, s: PressState, ...names: string[]) =>
    names.reduce((st, n) => pressSquare(a, st, n), s);

  it("selects, then moves on the second tap and clears the selection", () => {
    const { store, actions } = setup();
    const s1 = tap(actions, initialPress, "e2");
    expect(s1.selected).toBe("e2");
    const s2 = pressSquare(actions, s1, "e4");
    expect(s2).toEqual({ selected: null, promoting: null, message: "" });
    expect(boardView(store.game).find((q) => q.name === "e4")?.label).toBe("white pawn on e4");
  });

  it("tapping another own piece switches the selection", () => {
    const { store, actions } = setup();
    const s = tap(actions, initialPress, "e2", "d2");
    expect(s.selected).toBe("d2");
    expect(s.message).toBe("");
    expect(moveList(store.game)).toHaveLength(0);
  });

  it("tapping the selected square again deselects it", () => {
    const { actions } = setup();
    expect(tap(actions, initialPress, "e2", "e2").selected).toBeNull();
  });

  it("an illegal target clears the selection and shows the reason", () => {
    const { store, actions } = setup();
    const s = tap(actions, initialPress, "e2", "e5");
    expect(s.selected).toBeNull();
    expect(s.message).toContain("cannot move from e2 to e5");
    expect(moveList(store.game)).toHaveLength(0);
  });

  it("a promotion asks for a piece, then plays the chosen one", () => {
    const { store, actions } = promoSetup();
    const s1 = tap(actions, initialPress, "a7", "a8");
    expect(s1.promoting).toEqual({ from: "a7", to: "a8" });
    expect(s1.selected).toBe("a7");
    const s2 = playMove(actions, "a7", "a8", "n");
    expect(s2).toEqual({ selected: null, promoting: null, message: "" });
    expect(boardView(store.game).find((q) => q.name === "a8")?.label).toBe("white knight on a8");
  });

  it("tapping elsewhere while choosing a promotion cancels the choice", () => {
    const { store, actions } = promoSetup();
    const s1 = tap(actions, initialPress, "a7", "a8");
    const s2 = pressSquare(actions, s1, "a7");
    expect(s2.promoting).toBeNull();
  });
});
