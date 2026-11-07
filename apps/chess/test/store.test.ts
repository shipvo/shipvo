import { describe, expect, it, vi } from "vitest";
import { ChessStore } from "../src/index.js";
import { Game, parseFen } from "../src/engine.js";

describe("ChessStore", () => {
  it("labels every square and piece", () => {
    const b = new ChessStore().get_board();
    expect(b.squares).toHaveLength(64);
    expect(b.squares[0]).toMatchObject({ square: "a8", label: "black rook on a8" });
    expect(b.squares.find((s) => s.square === "e4")?.label).toBe("empty square e4");
  });

  it("legal_moves lists moves, optionally from one square", () => {
    const s = new ChessStore();
    expect(s.legal_moves()).toHaveLength(20);
    expect(s.legal_moves("g1").map((m) => m.to).sort()).toEqual(["f3", "h3"]);
  });

  it("a move() shows in the board the UI reads and in the move list", () => {
    const s = new ChessStore();
    const seen = vi.fn();
    s.subscribe(seen);
    const r = s.move("e2", "e4");
    expect(r.ok).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
    // The UI reads the same state:
    expect(s.get_board().squares.find((q) => q.square === "e4")?.label).toBe("white pawn on e4");
    expect(s.get_board().squares.find((q) => q.square === "e2")?.label).toBe("empty square e2");
    expect(s.get_board().turn).toBe("black");
    s.move("e7", "e5");
    expect(s.moveList()).toEqual([{ number: 1, white: "e2e4", black: "e7e5" }]);
    expect(s.moveDescriptions()[0]).toBe("white pawn from e2 to e4");
  });

  it("rejects illegal moves with a reason and leaves state unchanged", () => {
    const s = new ChessStore();
    const seen = vi.fn();
    s.subscribe(seen);
    const before = s.get_board().fen;
    for (const [f, t, re] of [
      ["e2", "e5", /Illegal move/],
      ["e4", "e5", /No piece on e4/],
      ["e7", "e5", /It is white's turn/],
      ["z9", "e5", /Bad square/],
    ] as const) {
      const r = s.move(f, t);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(re);
    }
    expect(s.get_board().fen).toBe(before);
    expect(s.moveList()).toEqual([]);
    expect(seen).not.toHaveBeenCalled();
  });

  it("rejects moves after checkmate", () => {
    const s = new ChessStore();
    for (const [f, t] of [["f2", "f3"], ["e7", "e5"], ["g2", "g4"], ["d8", "h4"]]) s.move(f, t);
    expect(s.get_board().status.state).toBe("checkmate");
    const r = s.move("a2", "a3");
    expect(r).toMatchObject({ ok: false, reason: "The game is over" });
  });

  it("asks for a promotion piece and rejects a bad one", () => {
    const s = new ChessStore();
    (s as unknown as { game: Game }).game = new Game(parseFen("8/P6k/8/8/8/8/8/K7 w - - 0 1"));
    const before = s.get_board().fen;
    const none = s.move("a7", "a8");
    expect(none).toMatchObject({ ok: false });
    if (!none.ok) expect(none.reason).toMatch(/Promotion needed/);
    // "k" is not a promotion piece; cast past the type to test the guard.
    const bad = s.move("a7", "a8", "k" as never);
    if (!bad.ok) expect(bad.reason).toMatch(/Illegal promotion: k/);
    expect(bad.ok).toBe(false);
    expect(s.get_board().fen).toBe(before);
    const good = s.move("a7", "a8", "n");
    expect(good).toMatchObject({ ok: true, move: "a7a8n" });
    expect(s.get_board().squares.find((q) => q.square === "a8")?.label).toBe("white knight on a8");
  });
});

describe("seats, time and notation", () => {
  it("refuses a move out of turn for a seated phone and says why", () => {
    const s = new ChessStore();
    s.setSeat("black");
    const r = s.move("e2", "e4");
    expect(r.ok).toBe(false);
    expect(s.lastNotice()).toContain("Wait for your turn");
    expect(s.outOfTurn()).toContain("It is white's turn. You play black.");
    expect(s.move("e2", "e4", undefined, { relay: true }).ok).toBe(true);
    expect(s.outOfTurn()).toBeNull();
    expect(s.lastNotice()).toBe("");
    expect(s.get_board()).toMatchObject({ lastMove: "e2e4", seat: "black", over: false });
  });
  it("ends the game on a lost clock", () => {
    const s = new ChessStore();
    s.timeout("white");
    expect(s.get_board()).toMatchObject({ over: true, result: "Time out, black wins", timeLoss: "white" });
    expect(s.move("e2", "e4").ok).toBe(false);
  });
  it("writes standard algebraic notation", () => {
    const s = new ChessStore();
    for (const u of ["f2f3", "e7e5", "g2g4", "d8h4"]) expect(s.move(u.slice(0, 2), u.slice(2, 4)).ok).toBe(true);
    expect(s.sanMoves()).toEqual(["f3", "e5", "g4", "Qh4#"]);
    const t = new ChessStore();
    for (const u of ["e2e4", "d7d5", "e4d5", "g8f6", "g1f3", "f6d5", "f1e2", "e7e6", "e1g1"]) t.move(u.slice(0, 2), u.slice(2, 4));
    expect(t.sanMoves()).toEqual(["e4", "d5", "exd5", "Nf6", "Nf3", "Nxd5", "Be2", "e6", "O-O"]);
  });
});
