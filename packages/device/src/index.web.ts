// Simulated device: the same API, backed by a device state the Shipvo simulator controls, with system sheets
// (permission dialog, camera viewfinder, fingerprint prompt, payment prompt, notification banner, share sheet)
// drawn as real dialogs so an agent sees and operates them exactly as it would a phone's.
import type { Device, PermissionStatus, Coords, ScanResult, AuthResult, PaymentResult, Notification } from "./types";
export * from "./types";

export type DeviceState = {
  appName: string;
  /** Which phone this simulates: dialog wording and defaults follow it. */
  platform: "android" | "ios"; api: number;
  permissions: Record<"camera" | "location" | "notifications", PermissionStatus>;
  location: Coords;
  /** What the camera "sees": a barcode in view, or nothing. */
  camera: { barcode?: { type: string; data: string } | null; delayMs?: number };
  biometrics: { enrolled: boolean; nextResult: "success" | "fail" | "cancel" };
  payment: { nextResult: "approve" | "decline" | "timeout" | "insufficient_funds"; pin?: string };
  online: boolean;
  clipboard: string;
  log: { at: number; kind: string; detail?: unknown }[];
};
const g = globalThis as any;
const cfg = g.__PN_SIM__ ?? {};
const platform: "android" | "ios" = cfg.device?.platform ?? "android"; const api: number = cfg.device?.api ?? 30;
const state: DeviceState = {
  appName: cfg.appName ?? "This app", platform, api,
  // Before Android 13 (API 33) notifications need no runtime permission.
  permissions: { camera: "undetermined", location: "undetermined", notifications: platform === "android" && api < 33 ? "granted" : "undetermined" },
  location: { latitude: 4.0225, longitude: 9.6967, accuracy: 20 }, // Bonapriso, Douala
  camera: { barcode: null, delayMs: 800 },
  biometrics: { enrolled: true, nextResult: "success" },
  payment: { nextResult: "approve", pin: "1234" },
  online: true, clipboard: "", log: [],
  ...(cfg.device ?? {}),
};
// Every entry is marked simulated: a simulated fingerprint or payment is for testing and is never a real verification or money movement.
const log = (kind: string, detail?: unknown) => state.log.push({ at: Date.now(), kind, detail, simulated: true } as any);
const netSubs = new Set<(o: boolean) => void>(); const openSubs = new Set<(n: Notification) => void>();

// ---- system sheets (plain DOM so they sit above the app and read as dialogs) ----
function sheet(label: string, build: (root: HTMLElement, close: () => void) => void): Promise<void> {
  return new Promise((done) => {
    const host = document.createElement("div");
    host.setAttribute("role", "dialog"); host.setAttribute("aria-modal", "true"); host.setAttribute("aria-label", label);
    host.setAttribute("data-pn-sheet", "1");
    Object.assign(host.style, { position: "fixed", left: "0", right: "0", bottom: "0", top: "0", background: "rgba(0,0,0,.45)", display: "flex", alignItems: "flex-end", zIndex: "9999", fontFamily: "system-ui, sans-serif" });
    const card = document.createElement("div");
    Object.assign(card.style, { background: "#fff", color: "#111", width: "100%", borderRadius: "16px 16px 0 0", padding: "20px", boxSizing: "border-box", display: "grid", gap: "12px" });
    const title = document.createElement("h1"); title.textContent = label; Object.assign(title.style, { fontSize: "17px", margin: "0", fontWeight: "700" });
    card.appendChild(title); host.appendChild(card);
    build(card, () => { host.remove(); done(); });
    document.body.appendChild(host);
  });
}
const btn = (text: string, onClick: () => void, primary = false) => {
  const b = document.createElement("button"); b.type = "button"; b.textContent = text; b.onclick = onClick;
  Object.assign(b.style, { minHeight: "44px", borderRadius: "10px", border: primary ? "0" : "1px solid #ccc", background: primary ? "#1366D6" : "#fff", color: primary ? "#fff" : "#111", fontSize: "16px", fontWeight: "600", padding: "0 16px" });
  return b;
};
const p = (text: string) => { const e = document.createElement("p"); e.textContent = text; Object.assign(e.style, { margin: "0", fontSize: "15px", lineHeight: "20px" }); return e; };

async function askPermission(name: "camera" | "location" | "notifications"): Promise<PermissionStatus> {
  if (state.permissions[name] !== "undetermined") return state.permissions[name];
  let result: PermissionStatus = "denied";
  // The system's own dialog, worded as the platform words it.
  const title = state.platform === "ios"
    ? (name === "camera" ? `“${state.appName}” Would Like to Access the Camera` : name === "location" ? `Allow “${state.appName}” to use your location?` : `“${state.appName}” Would Like to Send You Notifications`)
    : `Allow ${state.appName} to ${name === "camera" ? "take pictures and record video" : name === "location" ? "access this device's location" : "send you notifications"}?`;
  const choices: [string, PermissionStatus][] = state.platform === "ios"
    ? (name === "location" ? [["Allow Once", "granted"], ["Allow While Using App", "granted"], ["Don’t Allow", "denied"]] : name === "camera" ? [["Allow", "granted"], ["Don’t Allow", "denied"]] : [["Allow", "granted"], ["Don’t Allow", "denied"]])
    : (name === "notifications" ? [["Allow", "granted"], ["Don’t allow", "denied"]] : [["While using the app", "granted"], ["Only this time", "granted"], ["Deny", "denied"]]);
  await sheet(title, (card, close) => {
    const row = document.createElement("div"); Object.assign(row.style, { display: "grid", gap: "8px" });
    for (const [label, st] of choices) row.append(btn(label, () => { result = st; close(); }, st === "granted"));
    card.append(row);
  });
  state.permissions[name] = result; log("permission", { name, result }); return result;
}

const ALL_SIM = { camera: "simulated", location: "simulated", biometrics: "simulated", payments: "simulated", notifications: "simulated", share: "simulated", clipboard: "simulated", network: "simulated" } as const;
export const device: Device = {
  kind: "simulated",
  capabilities: () => ({ ...ALL_SIM }),
  permissions: { async get(name) { return state.permissions[name]; }, request: askPermission },
  location: {
    async current() {
      if ((await askPermission("location")) !== "granted") throw new Error("Location permission denied");
      if (!state.online && false) throw new Error("offline");
      log("location", state.location); return { ...state.location };
    },
  },
  camera: {
    async scan(opts) {
      if ((await askPermission("camera")) !== "granted") return null;
      let result: ScanResult | null = null;
      await sheet("Camera", (card, close) => {
        const view = document.createElement("div"); view.setAttribute("role", "img"); view.setAttribute("aria-label", "Camera viewfinder");
        Object.assign(view.style, { height: "220px", background: "#222", borderRadius: "12px" }); card.append(view, p(opts?.prompt ?? "Point the camera at a barcode"));
        card.append(btn("Cancel", () => { close(); }));
        if (state.camera.barcode) setTimeout(() => { result = { ...state.camera.barcode! }; close(); }, state.camera.delayMs ?? 800); // like a real scanner, it fires when the code is in view
      });
      log("scan", result); return result;
    },
  },
  auth: {
    async available() { return state.biometrics.enrolled; },
    async confirm(reason) {
      if (!state.biometrics.enrolled) return { ok: false, reason: "not_enrolled" };
      let r: AuthResult = { ok: false, reason: "cancelled" };
      await sheet("Confirm with fingerprint", (card, close) => {
        card.append(p(reason), p("Touch the fingerprint sensor"));
        card.append(btn("Use fingerprint", () => { r = state.biometrics.nextResult === "success" ? { ok: true } : state.biometrics.nextResult === "fail" ? { ok: false, reason: "failed" } : { ok: false, reason: "cancelled" }; close(); }, true), btn("Cancel", () => close()));
      });
      log("auth", r); return r;
    },
  },
  pay: {
    async charge(req, pin) {
      await new Promise((r) => setTimeout(r, 300));
      const n = state.payment.nextResult;
      const r: PaymentResult = state.payment.pin && pin !== state.payment.pin ? { ok: false, reason: "declined" }
        : n === "approve" ? { ok: true, receipt: `SIMULATED-${Date.now().toString(36).toUpperCase()}` } : n === "decline" ? { ok: false, reason: "declined" } : n === "timeout" ? { ok: false, reason: "timeout" } : { ok: false, reason: "insufficient_funds" };
      log("payment", { req, r }); return r;
    },
  },
  notifications: {
    async show(n) {
      if ((await askPermission("notifications")) !== "granted") return "";
      const id = `n${Date.now().toString(36)}`; showBanner({ id, ...n }); log("notification", { id, ...n }); return id;
    },
    onOpen(cb) { openSubs.add(cb); return () => { openSubs.delete(cb); }; },
  },
  share: {
    async text(text, title) {
      let ok = false;
      await sheet("Share", (card, close) => {
        card.append(p(title ?? text));
        for (const t of ["WhatsApp", "Messages", "Copy"]) card.append(btn(t, () => { ok = true; if (t === "Copy") state.clipboard = text; log("share", { target: t, text }); close(); }));
        card.append(btn("Cancel", () => close()));
      });
      return ok;
    },
  },
  clipboard: { async set(t) { state.clipboard = t; }, async get() { return state.clipboard; } },
  net: { online: () => state.online, onChange(cb) { netSubs.add(cb); return () => { netSubs.delete(cb); }; } },
};

// A notification banner at the top, like a heads-up notification: tapping it opens the app's handler.
const recent: Notification[] = [];
function showBanner(n: Notification) {
  recent.push(n); if (recent.length > 20) recent.shift();
  const b = document.createElement("div"); b.setAttribute("role", "button"); b.setAttribute("aria-label", `Notification: ${n.title}. ${n.body}`); b.tabIndex = 0; b.setAttribute("data-pn-banner", "1");
  // Like a heads-up notification: slim, over the status bar, gone after 5 s unless tapped.
  Object.assign(b.style, { position: "fixed", top: "4px", left: "8px", right: "8px", height: "44px", overflow: "hidden", background: "#fff", color: "#111", borderRadius: "12px", padding: "6px 12px", boxShadow: "0 6px 24px rgba(0,0,0,.25)", zIndex: "9998", fontFamily: "system-ui, sans-serif", whiteSpace: "nowrap", textOverflow: "ellipsis" });
  b.innerHTML = `<div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis">${n.title}</div><div style="font-size:12px;overflow:hidden;text-overflow:ellipsis">${n.body}</div>`;
  b.onclick = () => { b.remove(); openSubs.forEach((f) => f(n)); };
  document.body.appendChild(b); setTimeout(() => b.remove(), 5000);
}

// Control surface for the simulator (page.evaluate): set state, push a notification, flip the network, read the log.
g.__pnDevice = {
  state,
  set(patch: Partial<DeviceState>) { Object.assign(state, patch, { permissions: { ...state.permissions, ...(patch.permissions ?? {}) }, camera: { ...state.camera, ...(patch.camera ?? {}) }, biometrics: { ...state.biometrics, ...(patch.biometrics ?? {}) }, payment: { ...state.payment, ...(patch.payment ?? {}) } }); if (patch.online !== undefined) netSubs.forEach((f) => f(state.online)); },
  push(n: Omit<Notification, "id">) { const id = `n${Date.now().toString(36)}`; showBanner({ id, ...n }); },
  log: () => state.log,
  /** Notifications delivered so far (the banner is gone after 5 s, like a heads-up on a phone; this is the notification shade). */
  notifications: () => recent.map((n) => ({ id: n.id, title: n.title, body: n.body })),
  /** Tap a notification from the shade: same handler as tapping its banner. */
  openNotification(id?: string) { const n = id ? recent.find((x) => x.id === id) : recent[recent.length - 1]; if (!n) return false; document.querySelectorAll("[data-pn-banner]").forEach((e) => e.remove()); openSubs.forEach((f) => f(n)); log("notification_opened", { id: n.id }); return true; },
  capabilities: () => device.capabilities(),
  /** Back to a known state: permissions undetermined, default location, nothing in front of the camera, log cleared. */
  reset(profile?: Partial<DeviceState>) {
    Object.assign(state, { permissions: { camera: "undetermined", location: "undetermined", notifications: state.platform === "android" && state.api < 33 ? "granted" : "undetermined" },
      location: { latitude: 4.0225, longitude: 9.6967, accuracy: 20 }, camera: { barcode: null, delayMs: 800 }, biometrics: { enrolled: true, nextResult: "success" }, payment: { nextResult: "approve", pin: "1234" }, online: true, clipboard: "", log: [] }, profile ?? {});
    recent.length = 0;
    for (const el of document.querySelectorAll("[data-pn-sheet],[data-pn-banner]")) el.remove();
  },
};
export const simState = state;
export const simLog = log;
export const setOnline = (o: boolean) => g.__pnDevice.set({ online: o });
export const openUrl = async (url: string) => { window.dispatchEvent(new CustomEvent("pn:url", { detail: url })); };
// UI-owned bridges exist on native; on the simulated device the sheets are the UI, so they resolve immediately.
export const scanBridge = { subscribe: () => () => {}, current: () => null, finish: () => {} };
