import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from "react-native";
import { ChessGame } from "./src/actions";
import { name, squareLabel, type Square } from "./src/engine";
import { PALETTES, startNewGame, statusText, tapSquare } from "./src/ui";

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
  const c = PALETTES[useColorScheme() === "dark" ? "dark" : "light"];
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

  const newGame = () => {
    const r = startNewGame(game);
    setFrom(r.from); setNote(r.note); setSecs(0); bump((n) => n + 1);
  };

  const status = statusText(game);

  return (
    <View style={[s.root, { backgroundColor: c.bg }]} accessible={false}>
      <Text style={[s.title, { color: c.text }]} accessibilityRole="header">Chess</Text>
      <Text style={[s.status, { color: c.text }]} accessibilityLiveRegion="polite">{status}</Text>
      {!over && <Text style={[s.timer, { color: c.muted }]} accessibilityLabel="Move timer">Timer {secs} s</Text>}
      <View style={s.board} accessibilityLabel="Chess board">
        {[8, 7, 6, 5, 4, 3, 2, 1].map((r) => (
          <View key={r} style={s.row}>
            {"abcdefgh".split("").map((f, i) => {
              const at = `${f}${r}`, p = game.state.board[at];
              const dark = (i + r) % 2 === 1;
              return (
                <Pressable key={at} onPress={() => tap(at)} accessibilityRole="button"
                  accessibilityLabel={squareLabel(game.state, at) + (from === at ? ", selected" : targets.includes(at) ? ", legal move" : "")}
                  style={[s.sq, { backgroundColor: from === at ? c.selected : targets.includes(at) ? c.target : dark ? c.darkSq : c.lightSq }]}>
                  {p && (
                    <View style={[s.disc, p.color === "white" ? { backgroundColor: c.whiteFill, borderColor: c.blackFill } : { backgroundColor: c.blackFill, borderColor: c.whiteFill }]}>
                      <Text style={[s.piece, { color: p.color === "white" ? c.whiteInk : c.blackInk }]}>{GLYPH[name(p)]}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      <Pressable onPress={newGame} accessibilityRole="button" accessibilityLabel="New game" style={[s.btn, { backgroundColor: c.button }]}>
        <Text style={[s.btnText, { color: c.buttonText }]}>New game</Text>
      </Pressable>
      <Text style={[s.note, { color: c.text }]} accessibilityLiveRegion="polite">{note}</Text>
      <Text style={[s.h2, { color: c.text }]} accessibilityRole="header">Moves</Text>
      <ScrollView style={s.list}>
        {board.moves.length === 0 ? <Text style={[s.item, { color: c.text }]}>No moves yet.</Text> : board.moves.map((m, i) => (
          <Text key={i} style={[s.item, { color: c.text }]}>{m.color === "white" ? `${m.n}. ` : `${m.n}... `}{m.san} ({m.text})</Text>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingTop: 48, paddingHorizontal: 8 },
  title: { fontSize: 22, fontWeight: "700", color: "#222" },
  status: { fontSize: 15, color: "#222", marginVertical: 6 },
  timer: { fontSize: 13, color: "#555" },
  board: { aspectRatio: 1, width: "100%" },
  row: { flex: 1, flexDirection: "row" },
  sq: { flex: 1, alignItems: "center", justifyContent: "center" },
  disc: { width: "84%", aspectRatio: 1, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  piece: { fontSize: 24 },
  btn: { minHeight: 44, borderRadius: 8, alignItems: "center", justifyContent: "center", marginTop: 8 },
  btnText: { fontSize: 16, fontWeight: "700" },
  note: { fontSize: 14, color: "#333", marginVertical: 6 },
  h2: { fontSize: 16, fontWeight: "700", color: "#222" },
  list: { flex: 1 },
  item: { fontSize: 13, color: "#222", paddingVertical: 2 },
});
