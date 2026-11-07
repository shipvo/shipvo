import type { Promotion } from "./engine.js";
import type { ChessStore } from "./store.js";

/**
 * Lets a page that holds two phones keep their games the same. The app posts its move list to the
 * top window on every change, and plays moves that the top window sends back. Messages only count
 * when they come from the top window. On a plain `shipvo run` page nothing sends them.
 */
export interface LinkWindow {
  top: LinkTarget | null;
  addEventListener(type: "message", fn: (e: { data: unknown; source: unknown }) => void): void;
  removeEventListener(type: "message", fn: (e: { data: unknown; source: unknown }) => void): void;
}
export interface LinkTarget { postMessage(data: unknown, origin: string): void }

function splitUci(uci: string): { from: string; to: string; promotion?: Promotion } {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length > 4 ? { promotion: uci[4] as Promotion } : {}) };
}

export function linkToTop(store: ChessStore, win: LinkWindow): () => void {
  const top = win.top;
  if (!top) return () => {};
  const report = () => {
    const b = store.get_board();
    // "*" is fine: the message holds only move strings, and the app also loads on a plain `shipvo run` page.
    top.postMessage({ type: "chess:moves", moves: b.moves, san: store.sanMoves(), over: b.over, result: b.result }, "*");
  };
  const onMessage = (e: { data: unknown; source: unknown }) => {
    if (e.source !== top) return;
    const d = e.data as { type?: string; moves?: unknown; from?: unknown; to?: unknown; promotion?: unknown; seat?: unknown; loser?: unknown } | null;
    if (!d || typeof d !== "object") return;
    if (d.type === "chess:moves" && Array.isArray(d.moves)) {
      const have = store.get_board().moves.length;
      for (const uci of d.moves.slice(have)) {
        if (typeof uci !== "string" || !store.move(...moveArgs(uci), { relay: true }).ok) break;
      }
    } else if (d.type === "chess:play" && typeof d.from === "string" && typeof d.to === "string") {
      store.move(d.from, d.to, d.promotion as Promotion | undefined, { relay: true });
    } else if (d.type === "chess:seat" && (d.seat === "white" || d.seat === "black")) {
      store.setSeat(d.seat);
    } else if (d.type === "chess:timeout" && (d.loser === "white" || d.loser === "black")) {
      store.timeout(d.loser);
    }
  };
  const moveArgs = (uci: string): [string, string, Promotion | undefined] => {
    const m = splitUci(uci);
    return [m.from, m.to, m.promotion];
  };
  win.addEventListener("message", onMessage);
  const unsub = store.subscribe(report);
  report();
  return () => { unsub(); win.removeEventListener("message", onMessage); };
}
