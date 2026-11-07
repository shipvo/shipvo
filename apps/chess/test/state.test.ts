import { describe, expect, it } from "vitest";
import { createActions, createChessStore, viewOf } from "../src/index.js";

describe("shared state", () => {
  it("a move through move() shows in the view and the move list", () => {
    const store = createChessStore();
    const act = createActions(store);
    let renders = 0;
    store.subscribe(() => renders++);
    expect(viewOf(store).squares.find((s) => s.name === "e4")?.label).toBe("empty square e4");
    const r = act.move("e2", "e4");
    expect(r.ok).toBe(true);
    const v = viewOf(store);
    expect(v.squares.find((s) => s.name === "e4")?.label).toBe("white pawn on e4");
    expect(v.squares.find((s) => s.name === "e2")?.label).toBe("empty square e2");
    expect(v.moveList).toEqual([{ number: 1, white: "white pawn from e2 to e4", black: undefined, label: "Move 1: white pawn from e2 to e4" }]);
    expect(renders).toBe(1);
    act.move("e7", "e5");
    expect(viewOf(store).moveList[0].black).toBe("black pawn from e7 to e5");
    expect(act.get_board().turn).toBe("w");
  });

  it("lists 64 labelled squares and legal moves", () => {
    const act = createActions(createChessStore());
    const b = act.get_board();
    expect(b.squares).toHaveLength(64);
    expect(b.squares[0]).toMatchObject({ name: "a8", label: "black rook on a8" });
    expect(act.legal_moves("g1").sort()).toEqual(["g1f3", "g1h3"]);
    expect(act.legal_moves()).toHaveLength(20);
  });

  it("rejects illegal moves with a reason and leaves state alone", () => {
    const store = createChessStore();
    const act = createActions(store);
    expect(act.move("e2", "e5")).toEqual({ ok: false, reason: "Illegal move: e2 to e5" });
    expect(act.move("e4", "e5")).toEqual({ ok: false, reason: "No piece on e4" });
    expect(act.move("e7", "e5")).toEqual({ ok: false, reason: "It is white's turn" });
    expect(act.move("z9", "e5")).toMatchObject({ ok: false });
    expect(store.log).toHaveLength(0);
    expect(viewOf(store).moveList).toHaveLength(0);
  });

  it("asks for a promotion piece", () => {
    const store = createChessStore();
    const act = createActions(store);
    for (const [a, b] of [["a2","a4"],["b7","b5"],["a4","b5"],["a7","a6"],["b5","a6"],["c8","b7"],["a6","b7"],["g8","f6"]]) act.move(a, b);
    expect(act.move("b7", "a8")).toEqual({ ok: false, reason: "Promotion needed: pass q, r, b or n" });
    expect(act.move("b7", "a8", "q")).toMatchObject({ ok: true });
  });
});
