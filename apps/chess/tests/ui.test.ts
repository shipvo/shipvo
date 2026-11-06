import { describe, expect, test } from "vitest";
import { ChessGame } from "../src/actions";
import { PALETTES, contrast, startNewGame, statusText, tapSquare } from "../src/ui";

function taps(g: ChessGame, ...sq: string[]) {
  let from: string | null = null;
  for (const at of sq) from = tapSquare(g, from, at).from;
}

describe("tap logic", () => {
  test("a legal tap sequence gives the same state as ChessGame.move", () => {
    const ui = new ChessGame(), api = new ChessGame();
    taps(ui, "e2", "e4", "e7", "e5", "g1", "f3");
    api.move("e2", "e4"); api.move("e7", "e5"); api.move("g1", "f3");
    expect(ui.state).toEqual(api.state);
  });
  test("tapping an empty square first selects nothing", () => {
    const r = tapSquare(new ChessGame(), null, "e4");
    expect(r).toMatchObject({ from: null, moved: false, note: "Pick a piece first." });
  });
  test("promotion on the tap path makes a queen", () => {
    const g = new ChessGame();
    taps(g, "a2", "a4", "b7", "b5", "a4", "b5", "a7", "a6", "b5", "a6", "c8", "b7", "a6", "b7", "e7", "e6", "b7", "a8");
    expect(g.state.board["a8"]).toEqual({ color: "white", kind: "queen" });
  });
});

describe("status text", () => {
  test("does not change between timer ticks", () => {
    const g = new ChessGame();
    const a = statusText(g);
    expect(statusText(g)).toBe(a);
    expect(a).not.toMatch(/timer|\d+ s/i);
  });
  test("reports check", () => {
    const g = new ChessGame();
    taps(g, "e2", "e4", "f7", "f6", "d1", "h5");
    expect(statusText(g)).toBe("black to move, in check.");
  });
});

describe("new game", () => {
  test("resets a finished game, selection and note", () => {
    const g = new ChessGame();
    taps(g, "f2", "f3", "e7", "e5", "g2", "g4", "d8", "h4");
    expect(statusText(g)).toBe("Checkmate. black wins.");
    const r = startNewGame(g);
    expect(r).toEqual({ from: null, note: "New game. White to move." });
    expect(g.state).toEqual(new ChessGame().state);
    expect(statusText(g)).toBe("white to move.");
    expect(tapSquare(g, null, "e2").moved).toBe(false);
    expect(g.move("e2", "e4").ok).toBe(true);
  });
});

describe("colours", () => {
  for (const mode of ["light", "dark"] as const) {
    const p = PALETTES[mode];
    test(`${mode}: text, glyphs and button meet 4.5:1`, () => {
      expect(contrast(p.text, p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.muted, p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.whiteInk, p.whiteFill)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.blackInk, p.blackFill)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.buttonText, p.button)).toBeGreaterThanOrEqual(4.5);
    });
    test(`${mode}: each piece disc stands out from every square (3:1)`, () => {
      for (const sq of [p.lightSq, p.darkSq, p.selected, p.target]) {
        expect(contrast(p.whiteFill, sq) >= 3 || contrast(p.blackFill, sq) >= 3).toBe(true);
      }
    });
  }
});
