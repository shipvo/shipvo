import { useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import type { Promotion } from "./engine.js";
import type { BoardSnapshot, ChessStore } from "./store.js";

const GLYPHS: Record<string, string> = {
  wk: "♔", wq: "♕", wr: "♖", wb: "♗", wn: "♘", wp: "♙",
  bk: "♚", bq: "♛", br: "♜", bb: "♝", bn: "♞", bp: "♟",
};

const PROMOTIONS: { value: Promotion; name: string; glyph: string }[] = [
  { value: "q", name: "Queen", glyph: "♕" },
  { value: "r", name: "Rook", glyph: "♖" },
  { value: "b", name: "Bishop", glyph: "♗" },
  { value: "n", name: "Knight", glyph: "♘" },
];

export function statusText(board: BoardSnapshot): string {
  const s = board.status;
  const side = board.turn === "white" ? "White" : "Black";
  if (s.state === "checkmate") return `Checkmate, ${s.winner === "w" ? "white" : "black"} wins`;
  if (s.state === "draw") return s.reason === "stalemate" ? "Stalemate, draw" : `Draw (${s.reason})`;
  return s.check ? `${side} to move, check` : `${side} to move`;
}

const PAD = 12;
export function squareSize(windowWidth: number): number {
  return Math.max(40, Math.floor(Math.min(windowWidth - PAD * 2, 480) / 8));
}

export function App({ store }: { store: ChessStore }) {
  // The store is the only source of truth: re-read it on every change.
  const fen = useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.get_board().fen,
  );
  void fen;
  const board = store.get_board();
  const { width } = useWindowDimensions();
  const size = squareSize(width);
  const rows = store.moveList();

  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null);

  const targets = selected ? store.legal_moves(selected) : [];
  const targetSquares = new Set(targets.map((m) => m.to));
  const playing = board.status.state === "playing";

  const onSquare = (square: string) => {
    if (!playing || pending) return;
    if (selected && targetSquares.has(square)) {
      const options = targets.filter((m) => m.to === square);
      if (options.some((m) => m.promotion)) {
        setPending({ from: selected, to: square });
        return;
      }
      store.move(selected, square);
      setSelected(null);
      return;
    }
    // Tap a piece of the side to move to select it; anything else clears.
    const owns = store.legal_moves(square).length > 0;
    setSelected(owns && square !== selected ? square : null);
  };

  const choose = (p: Promotion) => {
    if (pending) store.move(pending.from, pending.to, p);
    setPending(null);
    setSelected(null);
  };

  return (
    <View style={styles.root} testID="chess-app">
      <Text style={styles.status} testID="status" accessibilityRole="header">
        {statusText(board)}
      </Text>
      <View style={[styles.board, { width: size * 8 }]} testID="board">
        {board.squares.map((sq) => {
          const isSel = sq.square === selected;
          const isTarget = targetSquares.has(sq.square);
          return (
            <Pressable
              key={sq.square}
              testID={`square-${sq.square}`}
              accessibilityRole="button"
              accessibilityLabel={isTarget ? `${sq.label}, legal move` : sq.label}
              accessibilityState={{ selected: isSel }}
              onPress={() => onSquare(sq.square)}
              style={[
                styles.square,
                { width: size, height: size },
                sq.dark ? styles.dark : styles.light,
                isTarget && styles.target,
                isSel && styles.selected,
              ]}
            >
              <Text style={styles.piece}>{sq.piece ? GLYPHS[sq.piece] : isTarget ? "•" : ""}</Text>
            </Pressable>
          );
        })}
      </View>
      {pending ? (
        <View style={styles.promo} testID="promotion">
          <Text style={styles.status}>Promote to</Text>
          {PROMOTIONS.map((p) => (
            <Pressable
              key={p.value}
              testID={`promote-${p.value}`}
              accessibilityRole="button"
              accessibilityLabel={`Promote to ${p.name.toLowerCase()}`}
              onPress={() => choose(p.value)}
              style={styles.promoButton}
            >
              <Text style={styles.promoText}>{`${p.glyph} ${p.name}`}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <ScrollView style={styles.moves} testID="move-list">
        {rows.map((r) => (
          <Text key={r.number} style={styles.moveText} testID={`move-${r.number}`}>
            {`${r.number}. ${r.white}${r.black ? ` ${r.black}` : ""}`}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 12, backgroundColor: "#fff" },
  status: { color: "#111", fontSize: 18, fontWeight: "600", marginBottom: 8 },
  board: { flexDirection: "row", flexWrap: "wrap" },
  square: { alignItems: "center", justifyContent: "center" },
  light: { backgroundColor: "#f0d9b5" },
  dark: { backgroundColor: "#b58863" },
  target: { backgroundColor: "#9ccc65" },
  selected: { backgroundColor: "#ffd54f" },
  piece: { color: "#111", fontSize: 28 },
  promo: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", marginTop: 8 },
  promoButton: { minWidth: 48, minHeight: 48, padding: 8, margin: 4, backgroundColor: "#eee", justifyContent: "center" },
  promoText: { color: "#111", fontSize: 16 },
  moveText: { color: "#111" },
  moves: { marginTop: 8, maxHeight: 160 },
});

export default App;
