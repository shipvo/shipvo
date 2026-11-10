// Turn the rows room_log returns into one summary per session. Pure, no I/O.
export type RoomEntry = {
  kind?: string; at?: string | number; session?: string; agent?: string | null;
  tool?: string; target?: string; change?: string; text?: string;
  title?: string; screen_title?: string;
};
export type SessionSummary = {
  session: string; agent: string | null; steps: number; seconds: number; errors: number;
  last_screen_title: string | null; notes: string[];
};

const ms = (at: RoomEntry["at"]) => { const t = typeof at === "number" ? at : Date.parse(at ?? ""); return Number.isFinite(t) ? t : undefined; };

export function summariseRoom(entries: RoomEntry[]): { sessions: SessionSummary[] } {
  type Acc = SessionSummary & { first: number; firstAt?: number; lastAt?: number };
  const by = new Map<string, Acc>();
  entries.forEach((e, i) => {
    const id = e.session ?? "";
    let s = by.get(id);
    if (!s) by.set(id, s = { session: id, agent: null, steps: 0, seconds: 0, errors: 0, last_screen_title: null, notes: [], first: i });
    if (s.agent === null && e.agent) s.agent = e.agent;
    const t = ms(e.at);
    if (t !== undefined) { s.firstAt = Math.min(s.firstAt ?? t, t); s.lastAt = Math.max(s.lastAt ?? t, t); }
    if (e.kind === "note") { if (typeof e.text === "string") s.notes.push(e.text); }
    else {
      if (e.tool) s.steps++;
      if (typeof e.change === "string" && e.change.startsWith("error")) s.errors++;
    }
    const title = e.title ?? e.screen_title;
    if (title) s.last_screen_title = title;
  });
  const rows = [...by.values()].sort((a, b) => (a.firstAt ?? Infinity) - (b.firstAt ?? Infinity) || a.first - b.first);
  return { sessions: rows.map(({ first: _f, firstAt, lastAt, ...s }) => ({ ...s, seconds: firstAt !== undefined && lastAt !== undefined ? Math.round((lastAt - firstAt) / 1000) : 0 })) };
}
