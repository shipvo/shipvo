import { ChessGame } from "./actions";
import { name, type Square } from "./engine";

export type Tap = { from: Square | null; note: string | null; moved: boolean };

/** One tap on a square: select a piece, move it (promotes to queen), or explain why not. */
export function tapSquare(game: ChessGame, from: Square | null, at: Square): Tap {
  const piece = game.state.board[at];
  if (from && game.legal_moves(from).some((m) => m.to === at)) {
    const r = game.move(from, at, "queen");
    return { from: null, note: r.ok ? r.move.text : r.error, moved: r.ok };
  }
  if (piece && piece.color === game.state.turn) {
    return { from: at, note: `${name(piece)} on ${at} selected. ${game.legal_moves(at).length} moves.`, moved: false };
  }
  return { from: null, note: piece ? `It is ${game.state.turn}'s turn.` : "Pick a piece first.", moved: false };
}

/** Turn, check and result only. The move timer is a separate element. */
export function statusText(game: ChessGame): string {
  const st = game.get_board().status;
  if (st.status === "checkmate") return `Checkmate. ${st.winner} wins.`;
  if (st.status === "stalemate" || st.status === "draw") return `Draw: ${st.reason}.`;
  return `${game.state.turn} to move${st.status === "check" ? ", in check" : ""}.`;
}

/** Start again: board, selection, note. The caller also resets its timer. */
export function startNewGame(game: ChessGame): { from: null; note: string } {
  game.reset();
  return { from: null, note: "New game. White to move." };
}

export type Palette = {
  bg: string; text: string; muted: string; lightSq: string; darkSq: string; selected: string; target: string;
  whiteFill: string; whiteInk: string; blackFill: string; blackInk: string; button: string; buttonText: string;
};

/** Each piece sits on its own disc, so glyph and disc contrast does not depend on the square colour. */
export const PALETTES: Record<"light" | "dark", Palette> = {
  light: {
    bg: "#F6F2EA", text: "#222222", muted: "#4A4A4A", lightSq: "#E8D5B5", darkSq: "#8A6B4B", selected: "#E0B33C", target: "#7FB06A",
    whiteFill: "#FFFFFF", whiteInk: "#111111", blackFill: "#1A1A1A", blackInk: "#FFFFFF", button: "#2B4A7A", buttonText: "#FFFFFF",
  },
  dark: {
    bg: "#16140F", text: "#EEE8DA", muted: "#C4BCAA", lightSq: "#B9A27E", darkSq: "#5E4630", selected: "#C99A1E", target: "#4F7F3F",
    whiteFill: "#FFFFFF", whiteInk: "#111111", blackFill: "#1A1A1A", blackInk: "#FFFFFF", button: "#9DB8E6", buttonText: "#10192B",
  },
};

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
/** WCAG contrast ratio of two #RRGGBB colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
