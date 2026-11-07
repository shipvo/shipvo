import { describe, expect, it } from "vitest";
import { ChessStore, linkToTop, type LinkWindow } from "../src/index.js";
import { formatClock, newClock, readClock, syncClock } from "../demo/clock.mjs";
import { DEMO_GAME } from "../demo/page.mjs";

function fakeWindow() {
  const posted: any[] = [];
  const top = { postMessage: (d: unknown) => posted.push(d) };
  let handler: ((e: { data: unknown; source: unknown }) => void) | undefined;
  const win: LinkWindow = {
    top,
    addEventListener: (_t, fn) => { handler = fn; },
    removeEventListener: () => { handler = undefined; },
  };
  return { win, top, posted, send: (data: unknown, source: unknown = top) => handler?.({ data, source }) };
}

describe("linkToTop", () => {
  it("reports moves and plays moves sent by the top window", () => {
    const store = new ChessStore();
    const w = fakeWindow();
    linkToTop(store, w.win);
    expect(w.posted.at(-1)).toEqual({ type: "chess:moves", moves: [], over: false });
    w.send({ type: "chess:moves", moves: ["e2e4", "e7e5"] });
    expect(store.get_board().moves).toEqual(["e2e4", "e7e5"]);
    expect(w.posted.at(-1).moves).toEqual(["e2e4", "e7e5"]);
  });
  it("ignores messages from other windows and bad moves", () => {
    const store = new ChessStore();
    const w = fakeWindow();
    linkToTop(store, w.win);
    w.send({ type: "chess:moves", moves: ["e2e4"] }, {});
    expect(store.get_board().moves).toEqual([]);
    w.send({ type: "chess:moves", moves: ["e2e5"] });
    expect(store.get_board().moves).toEqual([]);
  });
  it("does nothing without a top window", () => {
    const w = fakeWindow();
    w.win.top = null;
    linkToTop(new ChessStore(), w.win)();
    expect(w.posted).toEqual([]);
  });
});

describe("demo game", () => {
  it("is legal and ends in checkmate", () => {
    const store = new ChessStore();
    for (const u of DEMO_GAME) expect(store.move(u.slice(0, 2), u.slice(2, 4), u[4] as any).ok, u).toBe(true);
    expect(store.get_board().status).toMatchObject({ state: "checkmate", winner: "w" });
  });
});

describe("move timer", () => {
  it("runs the side to move and stops at the end", () => {
    let c = newClock(0);
    expect(readClock(c, 5000)).toEqual({ white: 5000, black: 0 });
    c = syncClock(c, 1, false, 5000);
    expect(readClock(c, 8000)).toEqual({ white: 5000, black: 3000 });
    c = syncClock(c, 2, true, 9000);
    expect(readClock(c, 99000)).toEqual({ white: 5000, black: 4000 });
    expect(formatClock(65_999)).toBe("1:05");
  });
});
