// Power, lock and restart for the simulated phone. The state machine is pure (no browser, no timers).
// `lockOverlay` and `bootOverlay` are functions that run inside the page.
// Everything here is simulated: nothing touches real hardware.

export class LifecycleError extends Error { constructor(code, message) { super(message); this.code = code; } }

// While locked, only these actions work. Pushes still arrive on a locked phone, so push_notification and notifications stay allowed. The rest fail with "locked" and nothing reaches the app.
export const WHILE_LOCKED = new Set(["screen", "screenshot", "push_notification", "notifications", "unlock", "lock", "restart", "errors", "device_log"]);

export function createLifecycle() {
  const st = { locked: false, restarts: 0, log: [] };
  const note = (kind, detail) => st.log.push({ at: Date.now(), kind, source: "simulated", ...(detail ? { detail } : {}) });
  return {
    get locked() { return st.locked; },
    /** Number of cold starts since the session opened. */
    get restarts() { return st.restarts; },
    log: () => st.log.map((e) => ({ ...e })),
    lock() {
      if (st.locked) throw new LifecycleError("already_locked", "the phone is already locked. Use unlock.");
      st.locked = true; note("lock");
    },
    unlock() {
      if (!st.locked) throw new LifecycleError("not_locked", "the phone is not locked, so there is nothing to unlock.");
      st.locked = false; note("unlock");
    },
    /** Call after the app was reloaded. A restart also leaves the lock screen, as a boot does. */
    restart() { st.locked = false; st.restarts++; note("restart", { restarts: st.restarts }); },
    /** Gate for every other action. Throws "locked" when the phone is locked. */
    guard(action) {
      if (st.locked && !WHILE_LOCKED.has(action)) throw new LifecycleError("locked", `the phone is locked, so '${action}' did not reach the app. Call unlock first.`);
    },
  };
}

const STYLE = "position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;font-family:system-ui,sans-serif;color:#fff;";

/** Runs in the page. Shows the lock screen with the time. The rest of the page is made inert and aria-hidden until `removeLockOverlay`. */
export function lockOverlay(style) {
  const d = new Date(); const t = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  document.querySelector("[data-pn-lock]")?.remove();
  // Hide the app from the accessibility tree and from input, as a locked phone shows no app content.
  for (const c of document.body.children) {
    if (c.hasAttribute("data-pn-hid")) continue;
    c.setAttribute("data-pn-hid", `${c.hasAttribute("inert") ? "i" : ""}${c.getAttribute("aria-hidden") ?? ""}`);
    c.setAttribute("inert", ""); c.setAttribute("aria-hidden", "true");
  }
  const el = document.createElement("div");
  el.setAttribute("data-pn-lock", ""); el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Lock screen");
  el.style.cssText = style + "background:linear-gradient(#10243a,#050b14);justify-content:space-between;padding:120px 0 40px;";
  el.innerHTML = `<div style="font-size:72px;font-weight:300">${t}</div><div>Swipe up to unlock</div>`;
  document.body.appendChild(el);
}
export function removeLockOverlay() {
  document.querySelector("[data-pn-lock]")?.remove();
  for (const c of document.querySelectorAll("[data-pn-hid]")) {
    const prev = c.getAttribute("data-pn-hid"); c.removeAttribute("data-pn-hid");
    if (!prev.startsWith("i")) c.removeAttribute("inert");
    const aria = prev.replace(/^i/, ""); if (aria) c.setAttribute("aria-hidden", aria); else c.removeAttribute("aria-hidden");
  }
}

/** Runs in the page. Boot screen with the Shipvo logo (our own mark: a rounded square with an arrow). */
export function bootOverlay(style) {
  document.querySelector("[data-pn-boot]")?.remove();
  const el = document.createElement("div");
  el.setAttribute("data-pn-boot", ""); el.setAttribute("role", "status"); el.setAttribute("aria-label", "Restarting");
  el.style.cssText = style + "background:#000;justify-content:center;gap:16px;";
  el.innerHTML = `<svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true"><rect width="72" height="72" rx="18" fill="#2563eb"/><path d="M36 18 52 44H20z" fill="#fff"/></svg><div style="font-weight:600;letter-spacing:.1em">SHIPVO</div>`;
  document.body.appendChild(el);
}

export const OVERLAY_STYLE = STYLE;

/** Cold start: show the boot screen, reload, record it. If the reload fails the boot screen is removed and the error rethrown. */
export async function coldStart(page, life, style, wait = 300) {
  await page.evaluate(`(${bootOverlay})(${JSON.stringify(style)})`).catch(() => {});
  await page.waitForTimeout(wait);
  try { await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(wait); }
  catch (e) { await page.evaluate(() => document.querySelector("[data-pn-boot]")?.remove()).catch(() => {}); throw e; }
  life.restart();
}
