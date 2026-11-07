import { describe, expect, it } from "vitest";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import { App } from "../src/App.js";
import { ChessStore } from "../src/store.js";

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
    expect(sq("b8").props.accessibilityLabel).toBe("black knight on b8");
    act(() => { r.root.find((n) => n.props.testID === "promote-n" && String(n.type) === "Pressable").props.onPress(); });
    expect(sq("b8").props.accessibilityLabel).toBe("white knight on b8");
    expect(r.root.findAll((n) => n.props.testID === "promotion")).toHaveLength(0);
    expect(text("status")).toMatch(/^Black to move/);
  });
});
