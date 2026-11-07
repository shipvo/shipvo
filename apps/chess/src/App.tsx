import React, { useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { chessActions } from "./actions.js";
import { chessStore } from "./store.js";
import { boardView, moveList } from "./view.js";

const GLYPH: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

export default function App() {
  useSyncExternalStore(chessStore.subscribe, chessStore.version);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const game = chessStore.game;
  const board = chessActions.get_board();
  const targets = new Set(selected ? chessActions.legal_moves({ from: selected }).map((m) => m.to) : []);

  const press = (name: string) => {
    if (selected && selected !== name) {
      const r = chessActions.move({ from: selected, to: name, promotion: "q" });
      setMessage(r.ok ? "" : r.reason);
      setSelected(null);
    } else {
      setSelected(selected === name ? null : name);
    }
  };

  return (
    <View style={s.page} accessibilityLabel="Chess">
      <Text style={s.title} accessibilityRole="header">Chess</Text>
      <Text accessibilityLabel={`Status: ${board.status}, ${board.turn} to move`}>{`${board.turn} to move: ${board.status}`}</Text>
      <View style={s.board} accessibilityLabel="Chess board">
        {boardView(game).map((q) => (
          <Pressable
            key={q.name}
            testID={`square-${q.name}`}
            accessibilityRole="button"
            accessibilityLabel={q.label}
            accessibilityState={{ selected: selected === q.name }}
            onPress={() => press(q.name)}
            style={[s.square, { backgroundColor: q.dark ? "#769656" : "#eeeed2" }, targets.has(q.name) && s.target, selected === q.name && s.selected]}
          >
            <Text style={s.glyph}>{GLYPH[q.piece] ?? ""}</Text>
          </Pressable>
        ))}
      </View>
      {message ? <Text accessibilityRole="alert" style={s.error}>{message}</Text> : null}
      <ScrollView style={s.moves} accessibilityLabel="Move list">
        {moveList(game).map((m) => <Text key={m}>{m}</Text>)}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, padding: 12, paddingTop: 48, gap: 8 },
  title: { fontSize: 24, fontWeight: "700" },
  board: { flexDirection: "row", flexWrap: "wrap", width: 320, height: 320 },
  square: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  glyph: { fontSize: 28 },
  target: { opacity: 0.7, borderWidth: 2, borderColor: "#f5a623" },
  selected: { borderWidth: 2, borderColor: "#1f6feb" },
  error: { color: "#b00020" },
  moves: { flex: 1 },
});
