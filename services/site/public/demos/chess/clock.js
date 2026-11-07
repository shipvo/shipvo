// Move timer for the two-phones page. Pure functions: the page passes in the time.
// State: { running: "white" | "black" | null, since: ms, white: ms, black: ms }.
// The side to move is running. A move hands the clock to the other side. A finished game stops it.
export function newClock(now) {
  return { running: "white", since: now, white: 0, black: 0 };
}

export function readClock(state, now) {
  const out = { white: state.white, black: state.black };
  if (state.running) out[state.running] += Math.max(0, now - state.since);
  return out;
}

/** Call after the move list changes. `plies` is how many moves were played; `over` is true when the game ended. */
export function syncClock(state, plies, over, now) {
  const next = over ? null : plies % 2 === 0 ? "white" : "black";
  if (next === state.running) return state;
  const t = readClock(state, now);
  return { running: next, since: now, white: t.white, black: t.black };
}

export function formatClock(ms) {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
