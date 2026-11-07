import { describe, expect, it } from "vitest";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import { App, statusText, squareSize } from "../src/App.js";
import { ChessStore } from "../src/store.js";
import { setWindowWidth } from "./rn-stub.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(store: ChessStore) {
  let r!: ReturnType<typeof create>;
  act(() => { r = create(<App store={store} />); });
  const sq = (name: string): ReactTestInstance => r.root.find((n) => n.props.testID === `square-${name}` && String(n.type) === "Pressable");
  const tap = (name: string) => act(() => { sq(name).props.onPress(); });
  const text = (id: string) => {
    const n = r.root.find((x) => x.props.testID === id && String(x.type) === "Text");
    return [n.props.children].flat().join("");
  };
  return { r, sq, tap, text };
}

describe("chess App", () => {
  it("renders 64 labelled squares", () => {
    const { r, sq } = mount(new ChessStore());
    const all = r.root.findAll((n) => String(n.type) === "Pressable" && String(n.props.testID).startsWith("square-"));
    expect(all).toHaveLength(64);
    expect(sq("g1").props.accessibilityLabel).toBe("white knight on g1");
    expect(sq("e4").props.accessibilityLabel).toBe("empty square e4");
    expect(all[0].props.testID).toBe("square-a8");
  });

  it("plays e2 to e4 by tapping", () => {
    const { sq, tap, text } = mount(new ChessStore());
    expect(text("status")).toBe("White to move");
    tap("e2");
    expect(sq("e2").props.accessibilityState.selected).toBe(true);
    tap("e4");
    expect(sq("e4").props.accessibilityLabel).toBe("white pawn on e4");
    expect(text("status")).toBe("Black to move");
    expect(text("move-1")).toBe("1. e2e4");
  });

  it("shows a move made through the typed action", () => {
    const store = new ChessStore();
    const { sq, text } = mount(store);
    act(() => { store.move("g1", "f3"); });
    expect(sq("f3").props.accessibilityLabel).toBe("white knight on f3");
    expect(text("status")).toBe("Black to move");
  });

  it("asks for a promotion piece", () => {
    const store = new ChessStore();
    // Reach a position with a white pawn on a7 by playing real moves.
    for (const [f, t] of [["a2","a4"],["b7","b5"],["a4","b5"],["a7","a6"],["b5","a6"],["c7","c6"],["a6","a7"],["c6","c5"]]) {
      expect(store.move(f, t).ok).toBe(true);
    }
    const { r, sq, tap, text } = mount(store);
    tap("a7");
    tap("b8");
    expect(r.root.findAll((n) => n.props.testID === "promotion")).not.toHaveLength(0);
    expect(sq("b8").props.accessibilityLabel).toBe("black knight on b8, legal move");
    act(() => { r.root.find((n) => n.props.testID === "promote-n" && String(n.type) === "Pressable").props.onPress(); });
    expect(sq("b8").props.accessibilityLabel).toBe("white knight on b8");
    expect(r.root.findAll((n) => n.props.testID === "promotion")).toHaveLength(0);
    expect(text("status")).toMatch(/^Black to move/);
  });

  it("fits the board to a 360 wide screen", () => {
    setWindowWidth(360);
    try {
      const { r } = mount(new ChessStore());
      const board = r.root.find((n) => n.props.testID === "board" && String(n.type) === "View");
      const w = board.props.style.find((x: object) => "width" in x).width;
      expect(w).toBeLessThanOrEqual(360 - 24);
      expect(squareSize(360)).toBeGreaterThanOrEqual(40);
    } finally { setWindowWidth(390); }
  });

  it("ignores board taps while the promotion chooser is open", () => {
    const store = new ChessStore();
    for (const [f, t] of [["a2","a4"],["b7","b5"],["a4","b5"],["a7","a6"],["b5","a6"],["c7","c6"],["a6","a7"],["c6","c5"]]) store.move(f, t);
    const { r, sq, tap } = mount(store);
    tap("a7");
    tap("b8");
    tap("a1");
    expect(sq("a7").props.accessibilityState.selected).toBe(true);
    expect(sq("a1").props.accessibilityState.selected).toBe(false);
    expect(r.root.findAll((n) => n.props.testID === "promotion")).not.toHaveLength(0);
  });

  it("marks legal targets in the label", () => {
    const { sq, tap } = mount(new ChessStore());
    tap("e2");
    expect(sq("e4").props.accessibilityLabel).toBe("empty square e4, legal move");
  });

  it("describes check and checkmate", () => {
    const store = new ChessStore();
    for (const [f, t] of [["f2","f3"],["e7","e5"],["g2","g4"],["d8","h4"]]) store.move(f, t);
    expect(statusText(store.get_board())).toBe("Checkmate, black wins");
    const s2 = new ChessStore();
    for (const [f, t] of [["e2","e4"],["f7","f6"],["d1","h5"]]) s2.move(f, t);
    expect(statusText(s2.get_board())).toBe("Black to move, check");
  });
});
