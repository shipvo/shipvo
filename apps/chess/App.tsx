import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChessGame } from "./src/actions";
import { name, squareLabel, type Square } from "./src/engine";
import { statusText, tapSquare } from "./src/ui";

const GLYPH: Record<string, string> = {
  "white king": "♔", "white queen": "♕", "white rook": "♖", "white bishop": "♗", "white knight": "♘", "white pawn": "♙",
  "black king": "♚", "black queen": "♛", "black rook": "♜", "black bishop": "♝", "black knight": "♞", "black pawn": "♟",
};

export default function App() {
  const [game] = useState(() => new ChessGame());
  const [, bump] = useState(0);
  const [from, setFrom] = useState<Square | null>(null);
  const [note, setNote] = useState("White to move.");
  const [secs, setSecs] = useState(0);
  const board = game.get_board();
  const over = ["checkmate", "stalemate", "draw"].includes(board.status.status);

  // Move timer: seconds the side to move has been thinking.
  useEffect(() => { setSecs(0); const t = setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(t); }, [board.moves.length]);

  const targets = from ? game.legal_moves(from).map((m) => m.to) : [];
  const tap = (at: Square) => {
    const r = tapSquare(game, from, at);
    setFrom(r.from);
    if (r.note) setNote(r.note);
    if (r.moved) bump((n) => n + 1);
  };

  const status = statusText(game);

  return (
    <View style={s.root} accessible={false}>
      <Text style={s.title} accessibilityRole="header">Chess</Text>
      <Text style={s.status} accessibilityLiveRegion="polite">{status}</Text>
      {!over && <Text style={s.timer} accessibilityLabel="Move timer">Timer {secs} s</Text>}
      <View style={s.board} accessibilityLabel="Chess board">
        {[8, 7, 6, 5, 4, 3, 2, 1].map((r) => (
          <View key={r} style={s.row}>
            {"abcdefgh".split("").map((f, i) => {
              const at = `${f}${r}`, p = game.state.board[at];
              const dark = (i + r) % 2 === 1;
              return (
                <Pressable key={at} onPress={() => tap(at)} accessibilityRole="button"
                  accessibilityLabel={squareLabel(game.state, at) + (from === at ? ", selected" : targets.includes(at) ? ", legal move" : "")}
                  style={[s.sq, { backgroundColor: from === at ? "#E0B33C" : targets.includes(at) ? "#7FB06A" : dark ? "#8A6B4B" : "#E8D5B5" }]}>
                  <Text style={s.piece}>{p ? GLYPH[name(p)] : ""}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      <Text style={s.note} accessibilityLiveRegion="polite">{note}</Text>
      <Text style={s.h2} accessibilityRole="header">Moves</Text>
      <ScrollView style={s.list}>
        {board.moves.length === 0 ? <Text style={s.item}>No moves yet.</Text> : board.moves.map((m, i) => (
          <Text key={i} style={s.item}>{m.color === "white" ? `${m.n}. ` : `${m.n}... `}{m.san} ({m.text})</Text>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingTop: 48, paddingHorizontal: 8, backgroundColor: "#F6F2EA" },
  title: { fontSize: 22, fontWeight: "700", color: "#222" },
  status: { fontSize: 15, color: "#222", marginVertical: 6 },
  timer: { fontSize: 13, color: "#555" },
  board: { aspectRatio: 1, width: "100%" },
  row: { flex: 1, flexDirection: "row" },
  sq: { flex: 1, alignItems: "center", justifyContent: "center" },
  piece: { fontSize: 28, color: "#111" },
  note: { fontSize: 14, color: "#333", marginVertical: 6 },
  h2: { fontSize: 16, fontWeight: "700", color: "#222" },
  list: { flex: 1 },
  item: { fontSize: 13, color: "#222", paddingVertical: 2 },
});
