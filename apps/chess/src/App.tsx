import React, { useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, useWindowDimensions, View } from "react-native";
import { chessActions } from "./actions.js";
import { chessStore } from "./store.js";
import type { Promotion } from "./engine.js";
import { initialPress, playMove, pressSquare, type PressState } from "./press.js";
import { boardView, moveList } from "./view.js";

const GLYPH: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

const PROMOTIONS: [Promotion, string][] = [["q", "Queen"], ["r", "Rook"], ["b", "Bishop"], ["n", "Knight"]];

export default function App() {
  useSyncExternalStore(chessStore.subscribe, chessStore.version);
  const [ui, setUi] = useState<PressState>(initialPress);
  const { selected, promoting, message } = ui;
  const dark = useColorScheme() === "dark";
  const { width } = useWindowDimensions();
  const size = Math.floor(width / 8);
  const fg = dark ? "#f2f2f2" : "#111111";
  const game = chessStore.game;
  const board = chessActions.get_board();
  const targets = new Set(selected ? chessActions.legal_moves({ from: selected }).map((m) => m.to) : []);

  const press = (name: string) => setUi(pressSquare(chessActions, ui, name));
  const play = (from: string, to: string, promotion?: Promotion) => setUi(playMove(chessActions, from, to, promotion));

  return (
    <View style={[s.page, { backgroundColor: dark ? "#121212" : "#ffffff" }]} accessibilityLabel="Chess">
      <Text style={[s.title, s.pad, { color: fg }]} accessibilityRole="header">Chess</Text>
      <Text style={[s.pad, { color: fg }]} accessibilityLabel={`Status: ${board.status}, ${board.turn} to move`}>{`${board.turn} to move: ${board.status}`}</Text>
      <View style={[s.board, { width: size * 8, height: size * 8 }]} accessibilityLabel="Chess board">
        {boardView(game).map((q) => (
          <Pressable
            key={q.name}
            testID={`square-${q.name}`}
            accessibilityRole="button"
            accessibilityLabel={q.label}
            accessibilityState={{ selected: selected === q.name }}
            onPress={() => press(q.name)}
            style={[s.square, { width: size, height: size, backgroundColor: q.dark ? "#b58863" : "#f0d9b5" }, targets.has(q.name) && s.target, selected === q.name && s.selected]}
          >
            <Text style={s.glyph}>{GLYPH[q.piece] ?? (targets.has(q.name) ? "●" : "")}</Text>
          </Pressable>
        ))}
      </View>
      {promoting ? (
        <View style={[s.promo, s.pad]} accessibilityLabel="Choose promotion piece">
          {PROMOTIONS.map(([code, name]) => (
            <Pressable
              key={code}
              testID={`promote-${code}`}
              accessibilityRole="button"
              accessibilityLabel={`Promote to ${name}`}
              onPress={() => play(promoting.from, promoting.to, code)}
              style={s.promoBtn}
            >
              <Text style={s.promoText}>{name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {message ? <Text accessibilityRole="alert" style={[s.error, s.pad, dark && { color: "#ff8a80" }]}>{message}</Text> : null}
      <ScrollView style={s.moves} contentContainerStyle={s.pad} accessibilityLabel="Move list">
        {moveList(game).map((m) => <Text key={m} style={{ color: fg }}>{m}</Text>)}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, paddingTop: 48, gap: 8 },
  pad: { paddingHorizontal: 12 },
  promo: { flexDirection: "row", gap: 8 },
  promoBtn: { minWidth: 44, minHeight: 44, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#0b57d0", borderRadius: 8 },
  promoText: { color: "#ffffff", fontWeight: "600" },
  title: { fontSize: 24, fontWeight: "700" },
  board: { flexDirection: "row", flexWrap: "wrap", alignSelf: "center" },
  square: { alignItems: "center", justifyContent: "center" },
  glyph: { fontSize: 28, color: "#111111" },
  target: { borderWidth: 4, borderColor: "#c62828" },
  selected: { borderWidth: 4, borderColor: "#0b57d0" },
  error: { color: "#b00020" },
  moves: { flex: 1 },
});
