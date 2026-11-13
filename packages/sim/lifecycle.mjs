// Lock, unlock and restart for the simulated phone. Pure state: no DOM, no timers.
// The server keeps one of these per session and logs each step; the frame page draws the lock screen and boot screen.

/** Typed error for a lifecycle action that cannot run now. */
export class LifecycleError extends Error { constructor(code, message) { super(message); this.code = code; } }

/** A new phone state: unlocked, never restarted. `reloads` counts cold starts of the app (the first load is 1). */
export function createLifecycle() {
  return { locked: false, method: "none", pin: null, failed: 0, reloads: 1, restarts: 0, log: [] };
}

const note = (st, name, extra = {}) => { st.log.push({ at: Date.now(), name, source: "simulated", ...extra }); };

/** Power press. Locks an unlocked phone. Throws already_locked if it is locked. */
export function lock(st) {
  if (st.locked) throw new LifecycleError("already_locked", "the phone is already locked: call unlock first");
  st.locked = true; note(st, "lock"); return st;
}

/**
 * Set how the phone unlocks: "none" (swipe up) or "pin" (4 to 8 digits). Changing an existing PIN needs the current one in `current`.
 * The PIN is kept in memory for the session and never logged.
 */
export function setLockMethod(st, { method, pin, current } = {}) {
  if (method !== "none" && method !== "pin") throw new LifecycleError("bad_method", "method: none or pin");
  if (method === "pin" && !/^\d{4,8}$/.test(String(pin ?? ""))) throw new LifecycleError("bad_pin", "pin: 4 to 8 digits");
  if (st.method === "pin" && String(current ?? "") !== st.pin) { note(st, "lock_method_denied"); throw new LifecycleError("wrong_pin", "current: the present PIN is needed to change the lock method"); }
  st.method = method; st.pin = method === "pin" ? String(pin) : null; st.failed = 0;
  note(st, "set_lock_method", { method }); return st;
}

/** Swipe up on the lock screen, and enter the PIN when the phone has one. Throws not_locked if the phone is unlocked, wrong_pin on a wrong PIN. The app and its screen are untouched. */
export function unlock(st, { pin } = {}) {
  if (!st.locked) throw new LifecycleError("not_locked", "the phone is not locked");
  if (st.method === "pin") {
    if (pin == null || String(pin) === "") throw new LifecycleError("pin_required", "the phone has a PIN: call unlock with pin");
    if (String(pin) !== st.pin) { st.failed++; note(st, "unlock_failed", { failed: st.failed }); throw new LifecycleError("wrong_pin", "that PIN is wrong"); }
  }
  st.failed = 0; st.locked = false; note(st, "unlock"); return st;
}

/** Restart from the power menu: the app cold-starts (the caller reloads it), storage is kept. The phone ends unlocked, or locked when it has a PIN. */
export function restart(st) {
  st.locked = st.method === "pin"; st.restarts++; st.reloads++; note(st, "restart", { reloads: st.reloads }); return st;
}

/** Throws a typed error when the phone is locked, so no input reaches the app behind the lock screen. */
export function assertUnlocked(st) {
  if (st.locked) throw new LifecycleError("phone_locked", "the phone is locked, so nothing was sent to the app. Call unlock first.");
}

/** Lock screen markup (time and a swipe hint). `time` is plain text such as "9:41". */
export function lockScreenHtml(time = "9:41") {
  const t = String(time).replace(/[<>&"'\\]/g, "").slice(0, 12);
  return `<div class="sf-lock" data-part="lock-screen" role="dialog" aria-label="Lock screen" tabindex="-1" hidden><div class="sf-lock-time" data-part="lock-time">${t}</div><div class="sf-lock-hint">Swipe up to unlock</div><button type="button" data-part="unlock-button">Unlock</button></div>`;
}

/** Boot screen markup: the Shipvo name on black. Shown for a moment during restart. */
export function bootScreenHtml() {
  return `<div class="sf-boot" data-part="boot-screen" hidden><div class="sf-boot-logo">Shipvo</div></div>`;
}

/** Screen shown after "Power off": black. A click on it, or the power button, turns the phone on again. */
export function offScreenHtml() {
  return `<div class="sf-off" data-part="off-screen" role="button" tabindex="0" aria-label="Phone is off. Press to power on" hidden></div>`;
}
