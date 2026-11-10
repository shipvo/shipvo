// Room log: what each session in a room did, in order, so a lead agent can poll its sub-agents. Pure: no I/O.
export type RoomEntry = { n: number; at: string; session: string | null; agent: string | null; tool: string; target: string | null; change: string | null; error?: boolean; text?: string };
export const NOTE_MAX = 500;
const LOG_MAX = 2000;

export class RoomLogs {
  private rooms = new Map<string, { owner: string; next: number; entries: RoomEntry[] }>();
  /** The first entry fixes the room's owner (the key that wrote it). */
  add(room: string, e: Omit<RoomEntry, "n" | "at"> & { at?: string }, owner = "local"): RoomEntry {
    const r = this.rooms.get(room) ?? { owner, next: 1, entries: [] };
    this.rooms.set(room, r);
    const entry: RoomEntry = { n: r.next++, at: e.at ?? new Date().toISOString(), ...e };
    r.entries.push(entry);
    if (r.entries.length > LOG_MAX) r.entries.splice(0, r.entries.length - LOG_MAX);
    return entry;
  }
  /** Entries after the cursor `since` (an entry number; 0 or none = all) and the cursor to pass next time. */
  since(room: string, since = 0): { entries: RoomEntry[]; cursor: number } {
    const r = this.rooms.get(room);
    const entries = (r?.entries ?? []).filter((e) => e.n > since);
    return { entries, cursor: entries.length ? entries[entries.length - 1]!.n : Math.max(since, 0) };
  }
  /** True when the room is new or belongs to `owner`. */
  canAccess(room: string, owner: string): boolean { const r = this.rooms.get(room); return !r || r.owner === owner; }
  all(room: string): RoomEntry[] { return this.rooms.get(room)?.entries ?? []; }
  drop(room: string) { this.rooms.delete(room); }
}

export const isFinding = (t: string) => /^\s*(finding|bug|issue)\b/i.test(t);
export const clean = (t: string) => t.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, NOTE_MAX);
export const line = (e: RoomEntry) =>
  `#${e.n} ${e.at} ${e.session ?? "lead"}${e.agent ? ` (${e.agent})` : ""} ${e.tool}${e.target ? ` ${e.target}` : ""}${e.change ? ` -> ${e.change}` : ""}${e.text ? `: ${e.text}` : ""}`;
