// One game, one place. The UI and the typed actions both use this store,
// so a move made through either shows up in the other.
import { Game, type Move } from "./engine.js";

export interface ChessStore {
  readonly game: Game;
  /** Increases on every change. Use it as the snapshot for useSyncExternalStore. */
  version(): number;
  subscribe(listener: () => void): () => void;
  /** Play a move on the shared game and tell listeners. Throws if illegal. */
  play(m: Move | string): Move;
  reset(): void;
}

export function createStore(): ChessStore {
  let game = new Game();
  let version = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    version++;
    for (const l of [...listeners]) l();
  };
  return {
    get game() {
      return game;
    },
    version: () => version,
    subscribe(l) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    play(m) {
      const played = game.play(m);
      emit();
      return played;
    },
    reset() {
      game = new Game();
      emit();
    },
  };
}

/** The store the app and its actions share. */
export const chessStore: ChessStore = createStore();
