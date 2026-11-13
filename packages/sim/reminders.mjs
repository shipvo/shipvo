// Reminders: a notification that arrives at a time on the phone's clock, whether or not an app is open.
// The scheduler checks the phone clock (set_time moves it), so a test can jump to the time and see the reminder fire.

export class ReminderError extends Error { constructor(code, message) { super(message); this.code = code; } }

const REPEAT_MS = { daily: 86_400_000, weekly: 7 * 86_400_000 };
const MAX_REMINDERS = 50;
const MAX_LOG = 200;

const p2 = (n) => String(n).padStart(2, "0");
/** A time on the phone's clock as 2026-11-14T09:00, the same form parseAt reads. */
export const localIso = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };

/** Parses a phone-local time such as 2026-11-14T09:00 (the same form set_time takes) to milliseconds. */
export function parseAt(at) {
  const t = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(String(at)) ? Date.parse(String(at)) : NaN;
  if (Number.isNaN(t)) throw new ReminderError("bad_time", "at must be a time like 2026-11-14T09:00 on the phone's clock (use in_minutes for a time from now)");
  return t;
}

/**
 * @param now   () => the phone clock in ms
 * @param fire  async (reminder) => { delivered: boolean } hands the notification to the phone
 */
export function createReminders(now, fire, opts = {}) {
  const items = new Map();   // id -> { id, title, body, at, repeat, created }
  const history = [];        // what fired: { id, title, due, firedAt, delivered }
  let seq = 0;
  const view = (r) => ({ id: r.id, title: r.title, body: r.body, at: localIso(r.at), repeat: r.repeat ?? "none" });
  let running = false;
  return {
    add({ title, body = "", at, in_minutes, repeat }) {
      const t = String(title ?? "").trim();
      if (!t) throw new ReminderError("bad_title", "a reminder needs a title");
      if (t.length > 200 || String(body).length > 1000) throw new ReminderError("too_long", "title is at most 200 characters and body at most 1000");
      if ((at == null) === (in_minutes == null)) throw new ReminderError("bad_time", "give either at (a phone-clock time) or in_minutes, not both and not neither");
      let when;
      if (at != null) when = parseAt(at);
      else { const m = Number(in_minutes); if (!Number.isFinite(m) || m < 0 || m > 525_600) throw new ReminderError("bad_time", "in_minutes must be a number from 0 to 525600"); when = now() + Math.round(m * 60_000); }
      if (repeat != null && repeat !== "none" && !REPEAT_MS[repeat]) throw new ReminderError("bad_repeat", 'repeat can be "none", "daily" or "weekly"');
      if (items.size >= MAX_REMINDERS) throw new ReminderError("too_many", `at most ${MAX_REMINDERS} reminders on a phone`);
      const r = { id: `r${++seq}`, title: t, body: String(body), at: when, repeat: repeat && repeat !== "none" ? repeat : null };
      items.set(r.id, r);
      return view(r);
    },
    list() { return { reminders: [...items.values()].sort((a, b) => a.at - b.at).map(view), fired: history.slice(-20) }; },
    cancel(id) { return items.delete(String(id)); },
    /** Fires every reminder that is due on the phone clock. A jump over several repeats fires once, then moves to the next time after now. */
    async tick() {
      if (running) return 0; running = true;
      try {
        const t = now(); let n = 0;
        for (const r of [...items.values()].filter((x) => x.at <= t).sort((a, b) => a.at - b.at)) {
          const due = r.at;
          if (r.repeat) { const step = REPEAT_MS[r.repeat]; r.at += Math.ceil((t - r.at + 1) / step) * step; } else items.delete(r.id);
          let delivered = false; try { delivered = (await fire(r))?.delivered === true; } catch { /* the phone could not take it: recorded as not delivered */ }
          history.push({ id: r.id, title: r.title, due: localIso(due), delivered }); if (history.length > MAX_LOG) history.shift();
          n++;
        }
        return n;
      } finally { running = false; }
    },
    get size() { return items.size; },
  };
}
