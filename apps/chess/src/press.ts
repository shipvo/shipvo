import type { createActions, MoveResult } from "./actions.js";
import type { Promotion } from "./engine.js";

export interface PressState {
  selected: string | null;
  promoting: { from: string; to: string } | null;
  message: string;
}

export const initialPress: PressState = { selected: null, promoting: null, message: "" };

type Actions = Pick<ReturnType<typeof createActions>, "legal_moves" | "move">;

/** Pure tap handler: the next UI state after a square is tapped. */
export function pressSquare(actions: Actions, state: PressState, name: string): PressState {
  const { selected } = state;
  const base: PressState = { ...state, promoting: null };
  if (!selected) {
    return { ...base, selected: name, message: "" };
  }
  if (selected === name) return { ...base, selected: null };
  const targets = actions.legal_moves({ from: selected });
  if (!targets.some((m) => m.to === name) && actions.legal_moves({ from: name }).length > 0) {
    return { ...base, selected: name, message: "" };
  }
  if (targets.filter((m) => m.to === name && m.promotion).length > 1) {
    return { ...base, promoting: { from: selected, to: name } };
  }
  return playMove(actions, selected, name);
}

/** Plays a move and returns the state after it: selection cleared, reason shown on failure. */
export function playMove(actions: Actions, from: string, to: string, promotion?: Promotion): PressState {
  const r: MoveResult = actions.move({ from, to, promotion });
  return { selected: null, promoting: null, message: r.ok ? "" : r.reason };
}
