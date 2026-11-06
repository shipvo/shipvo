// Lock, unlock and restart for the simulated phone. Pure state: no DOM, no timers.
// The server keeps one of these per session and logs each step; the frame page draws the lock screen and boot screen.

/** Typed error for a lifecycle action that cannot run now. */
export class LifecycleError extends Error { constructor(code, message) { super(message); this.code = code; } }

/** A new phone state: unlocked, never restarted. `reloads` counts cold starts of the app (the first load is 1). */
export function createLifecycle() {
  return { locked: false, reloads: 1, restarts: 0, log: [] };
}

const note = (st, name, extra = {}) => { st.log.push({ at: Date.now(), name, source: "simulated", ...extra }); };

/** Power press. Locks an unlocked phone. Throws already_locked if it is locked. */
export function lock(st) {
  if (st.locked) throw new LifecycleError("already_locked", "the phone is already locked: call unlock first");
  st.locked = true; note(st, "lock"); return st;
}

/** Swipe up on the lock screen. Throws not_locked if the phone is unlocked. The app and its screen are untouched. */
export function unlock(st) {
  if (!st.locked) throw new LifecycleError("not_locked", "the phone is not locked");
  st.locked = false; note(st, "unlock"); return st;
}

/** Restart from the power menu: the app cold-starts (the caller reloads it), storage is kept, the phone ends unlocked. */
export function restart(st) {
  st.locked = false; st.restarts++; st.reloads++; note(st, "restart", { reloads: st.reloads }); return st;
}

/** Throws a typed error when the phone is locked, so no input reaches the app behind the lock screen. */
export function assertUnlocked(st) {
  if (st.locked) throw new LifecycleError("phone_locked", "the phone is locked, so nothing was sent to the app. Call unlock first.");
}

/** Lock screen markup (time and a swipe hint). `time` is plain text such as "9:41". */
export function lockScreenHtml(time = "9:41") {
  const t = String(time).replace(/[<>&"'\\]/g, "").slice(0, 12);
  return `<div class="sf-lock" data-part="lock-screen" hidden><div class="sf-lock-time" data-part="lock-time">${t}</div><div class="sf-lock-hint">Swipe up to unlock</div></div>`;
}

/** Boot screen markup: the Shipvo name on black. Shown for a moment during restart. */
export function bootScreenHtml() {
  return `<div class="sf-boot" data-part="boot-screen" hidden><div class="sf-boot-logo">Shipvo</div></div>`;
}
