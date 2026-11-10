// The permission log: every grant, denial, removal, use and block of a device permission, per app, newest last.
// Kept for the session; the oldest entries go after MAX.

export class PermissionLogError extends Error { constructor(code, message) { super(message); this.code = code; } }

const MAX = 500;
const EVENTS = ["granted", "denied", "removed", "used", "blocked"];

export function createPermissionLog(now = () => Date.now()) {
  const entries = [];
  return {
    /** One entry: app, permission, event (granted, denied, removed, used, blocked), by (install, update, settings, prompt, an action name) and optional caller. */
    add(e) {
      if (!EVENTS.includes(e.event)) throw new Error(`permission log: unknown event ${e.event}`);
      entries.push({ at: now(), app: e.app, permission: e.permission, event: e.event, by: e.by, ...(e.caller ? { caller: e.caller } : {}) });
      if (entries.length > MAX) entries.splice(0, entries.length - MAX);
    },
    /** Answers before and after (install, update or import): logs each grant, denial and removal. */
    answers(app, before, after, by) {
      for (const [p, v] of Object.entries(after ?? {})) if (!before || before[p] !== v) this.add({ app, permission: p, event: v === false ? "denied" : "granted", by });
      for (const p of Object.keys(before ?? {})) if (!after || !(p in after)) this.add({ app, permission: p, event: "removed", by });
    },
    /** Newest last. Filters: app, permission, event; limit 1 to 500 (default 100). */
    list(q = {}) {
      const limit = q.limit == null ? 100 : Number(q.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX) throw new PermissionLogError("bad_limit", `limit: a whole number from 1 to ${MAX}`);
      if (q.event != null && !EVENTS.includes(q.event)) throw new PermissionLogError("bad_event", `event: one of ${EVENTS.join(", ")}`);
      const out = entries.filter((e) => (q.app == null || e.app === q.app) && (q.permission == null || e.permission === q.permission) && (q.event == null || e.event === q.event));
      return out.slice(-limit).map((e) => ({ ...e }));
    },
  };
}
