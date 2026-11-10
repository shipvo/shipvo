// Simulated device: the same API, backed by a device state the Shipvo simulator controls, with system sheets
// (permission dialog, camera viewfinder, fingerprint prompt, payment prompt, notification banner, share sheet)
// drawn as real dialogs so an agent sees and operates them exactly as it would a phone's.
import { mayUseReal, openStream, levelMeter, stopStream, realPosition, barcodeDetector, type Source } from "./real";
import type { ConnectionType, NetworkProfileName, Device, PermissionStatus, Coords, ScanResult, AuthResult, PaymentResult, Notification, Contact, CalendarEvent, PermissionName, PickedFile } from "./types";
export * from "./types";

export type DeviceState = {
  appName: string;
  /** Which phone this simulates: dialog wording and defaults follow it. */
  platform: "android" | "ios"; api: number;
  permissions: Record<PermissionName, PermissionStatus>;
  /** The address book the app can read once contacts permission is granted. */
  contacts: Contact[];
  /** The calendar the app can read once calendar permission is granted. */
  calendar: CalendarEvent[];
  /** The files the picker offers. `content` is the file's text. */
  files: { name: string; mimeType: string; content: string }[];
  /** "auto" uses the real camera, microphone and location when a person is present and allows it. "simulated" forces the simulated device every time. */
  source: "auto" | "simulated";
  location: Coords;
  /** The microphone: `level` is what the simulated microphone hears, 0 to 1. */
  microphone: { level: number };
  /** What the camera "sees": a barcode in view, or nothing. */
  camera: { barcode?: { type: string; data: string } | null; delayMs?: number };
  biometrics: { enrolled: boolean; nextResult: "success" | "fail" | "cancel" };
  payment: { nextResult: "approve" | "decline" | "cancel" | "timeout" | "insufficient_funds"; pin?: string };
  online: boolean;
  /** The network profile the simulator runs under. `online` (the default) leaves connectivity as the switches say. */
  networkProfile: NetworkProfileName;
  /** Airplane mode: the network is off and the status bar shows the airplane icon. */
  airplane: boolean;
  /** Quick-settings switches (notification shade and Control Center). Wi-Fi and mobile data both off means no network. */
  wifi: boolean; mobileData: boolean; locationServices: boolean; darkMode: boolean; dnd: boolean; autoRotate: boolean; flashlight: boolean; orientationLock: boolean; brightness: number;
  /** System appearance and language settings the app reads through Appearance, PixelRatio, AccessibilityInfo, I18nManager and Intl. */
  fontSize: "small" | "default" | "large" | "largest"; boldText: boolean; reduceMotion: boolean; language: "en" | "fr" | "ar"; rtl: boolean;
  /** The battery the status bar shows. */
  battery: { level: number; charging: boolean };
  clipboard: string;
  log: { at: number; kind: string; detail?: unknown }[];
};
const g = globalThis as any;
const cfg = g.__PN_SIM__ ?? {};
const platform: "android" | "ios" = cfg.device?.platform ?? "android"; const api: number = cfg.device?.api ?? 30;
const state: DeviceState = {
  appName: cfg.appName ?? "This app", platform, api,
  // Before Android 13 (API 33) notifications need no runtime permission.
  permissions: { camera: "undetermined", microphone: "undetermined", location: "undetermined", contacts: "undetermined", calendar: "undetermined", notifications: platform === "android" && api < 33 ? "granted" : "undetermined" },
  contacts: [],
  calendar: [],
  files: [],
  source: "auto",
  location: { latitude: 4.0225, longitude: 9.6967, accuracy: 20 }, // Bonapriso, Douala
  microphone: { level: 0.2 },
  camera: { barcode: null, delayMs: 800 },
  biometrics: { enrolled: true, nextResult: "success" },
  payment: { nextResult: "approve", pin: "1234" },
  online: true, networkProfile: "online", airplane: false, wifi: true, mobileData: true, locationServices: true, darkMode: false, dnd: false, autoRotate: true, flashlight: false, orientationLock: false, brightness: 70,
  fontSize: "default", boldText: false, reduceMotion: false, language: "en", rtl: false,
  battery: { level: 100, charging: false }, clipboard: "", log: [],
  ...(cfg.device ?? {}),
};
// Every entry is marked simulated: a simulated fingerprint or payment is for testing and is never a real verification or money movement.
// Readings from real hardware are marked source "real".
const log = (kind: string, detail?: unknown, source: Source = "simulated") => state.log.push({ at: Date.now(), kind, detail, source, simulated: source === "simulated" } as any);
// Network, airplane and battery feed the phone frame's status bar. Every change is logged (simulated) and announced as a "pn:status" event.
const isOnline = () => state.online && state.networkProfile !== "offline" && !state.airplane && (state.wifi || state.mobileData);
// A slow profile is a cellular link of the matching generation. `spotty` (500 kbps down in the sim's table) is closest to 3g.
const PROFILE_GEN: Record<string, ConnectionType> = { "2g": "2g", "3g": "3g", "slow-4g": "4g", "low-end-4g": "4g", spotty: "3g" };
/** The connection type: "none" when not connected; a slow profile reports its cellular generation; otherwise Wi-Fi if on, else generic cellular. */
const connectionType = (): ConnectionType => !isOnline() ? "none" : PROFILE_GEN[state.networkProfile] ?? (state.wifi ? "wifi" : "cellular");
const netKey = () => `${isOnline()}|${connectionType()}`;
const SETTINGS = ["wifi", "mobileData", "locationServices", "darkMode", "dnd", "autoRotate", "flashlight", "orientationLock", "brightness", "airplane"] as const;
const settings = () => Object.fromEntries(SETTINGS.map((k) => [k, state[k]]));
const SYSTEM = ["darkMode", "fontSize", "boldText", "reduceMotion", "language", "rtl"] as const;
const system = () => Object.fromEntries(SYSTEM.map((k) => [k, state[k]]));
const systemKey = () => JSON.stringify(system());
/** Logs each changed system setting (simulated) and tells the page, so the app's Appearance, PixelRatio, AccessibilityInfo and I18nManager follow. */
function announceSystem(before: string, record = true) {
  if (systemKey() === before) return;
  const was = JSON.parse(before); const now = system();
  if (record) for (const k of SYSTEM) if (was[k] !== (now as any)[k]) log("setting", { key: k, value: (now as any)[k] });
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("pn:system", { detail: now }));
}
const settingsKey = () => JSON.stringify(settings());
const statusKey = () => JSON.stringify([state.online, state.networkProfile, state.airplane, isOnline(), state.battery.level, state.battery.charging]);
function announceStatus(before: string, record = true, beforeSettings = "") {
  if (beforeSettings && settingsKey() !== beforeSettings && typeof window !== "undefined") { if (record) log("settings", settings()); window.dispatchEvent(new CustomEvent("pn:settings", { detail: settings() })); }
  if (statusKey() === before) return;
  const detail = { online: isOnline(), airplane: state.airplane, battery: { ...state.battery } };
  if (record) log("status", detail);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("pn:status", { detail }));
}
const urlSubs = new Set<(url: string) => void>();
const netSubs = new Set<(o: boolean) => void>(); const openSubs = new Set<(n: Notification) => void>(); const recvSubs = new Set<(n: Notification) => void>();

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
const unknownNextResult = (n: unknown): never => { throw new Error(`unknown payment.nextResult "${n}"`); };
const p = (text: string) => { const e = document.createElement("p"); e.textContent = text; Object.assign(e.style, { margin: "0", fontSize: "15px", lineHeight: "20px" }); return e; };

async function askPermission(name: PermissionName): Promise<PermissionStatus> {
  if (state.permissions[name] !== "undetermined") return state.permissions[name];
  let result: PermissionStatus = "denied";
  // The system's own dialog, worded as the platform words it.
  const title = state.platform === "ios"
    ? (name === "camera" ? `“${state.appName}” Would Like to Access the Camera` : name === "microphone" ? `“${state.appName}” Would Like to Access the Microphone` : name === "location" ? `Allow “${state.appName}” to use your location?` : name === "contacts" ? `“${state.appName}” Would Like to Access Your Contacts` : name === "calendar" ? `“${state.appName}” Would Like to Access Your Calendar` : `“${state.appName}” Would Like to Send You Notifications`)
    : `Allow ${state.appName} to ${name === "camera" ? "take pictures and record video" : name === "microphone" ? "record audio" : name === "location" ? "access this device's location" : name === "contacts" ? "access your contacts" : name === "calendar" ? "access your calendar" : "send you notifications"}?`;
  const choices: [string, PermissionStatus][] = state.platform === "ios"
    ? (name === "location" ? [["Allow Once", "granted"], ["Allow While Using App", "granted"], ["Don’t Allow", "denied"]] : name === "camera" ? [["Allow", "granted"], ["Don’t Allow", "denied"]] : [["Allow", "granted"], ["Don’t Allow", "denied"]])
    : (name === "notifications" || name === "contacts" || name === "calendar" ? [["Allow", "granted"], name !== "notifications" ? ["Deny", "denied"] : ["Don’t allow", "denied"]] : [["While using the app", "granted"], ["Only this time", "granted"], ["Deny", "denied"]]);
  await sheet(title, (card, close) => {
    const row = document.createElement("div"); Object.assign(row.style, { display: "grid", gap: "8px" });
    for (const [label, st] of choices) row.append(btn(label, () => { result = st; close(); }, st === "granted"));
    card.append(row);
  });
  state.permissions[name] = result; log("permission", { name, result }); return result;
}

const ALL_SIM = { camera: "simulated", location: "simulated", biometrics: "simulated", payments: "simulated", notifications: "simulated", share: "simulated", clipboard: "simulated", contacts: "simulated", calendar: "simulated", files: "simulated", network: "simulated" } as const;
export const device: Device = {
  kind: "simulated",
  // "real" when this page would try the real hardware (a person is present and the source is not forced), so the report is never a silent fallback.
  capabilities: () => { const r = mayUseReal(state.source) ? "real" as const : "simulated" as const; return { ...ALL_SIM, camera: r, location: r, microphone: r }; },
  permissions: { async get(name) { return state.permissions[name]; }, request: askPermission },
  location: {
    async current() {
      if ((await askPermission("location")) !== "granted") throw new Error("Location permission denied");
      if (!state.locationServices) { log("location_off", {}); throw new Error("Location services are turned off"); }
      if (mayUseReal(state.source)) {
        const pos = await realPosition(); // the browser's own prompt is a second gate
        if (pos) { log("location", pos, "real"); return pos; }
      }
      if (!state.online && false) throw new Error("offline");
      log("location", state.location); return { ...state.location };
    },
  },
  camera: {
    async scan(opts) {
      if ((await askPermission("camera")) !== "granted") return null;
      const stream = mayUseReal(state.source) ? await openStream({ video: { facingMode: "environment" } }) : null;
      let result: ScanResult | null = null; let source: Source = "simulated";
      const detector = stream ? barcodeDetector() : null;
      let timer: ReturnType<typeof setInterval> | undefined;
      await sheet("Camera", (card, close) => {
        let view: HTMLElement = document.createElement("div"); view.setAttribute("role", "img"); view.setAttribute("aria-label", "Camera viewfinder");
        Object.assign(view.style, { height: "220px", background: "#222", borderRadius: "12px" });
        if (stream) {
          const video = document.createElement("video"); video.setAttribute("role", "img"); video.setAttribute("aria-label", "Camera viewfinder");
          video.muted = true; video.setAttribute("playsinline", ""); (video as any).srcObject = stream; video.play?.().catch(() => {});
          Object.assign(video.style, { height: "220px", width: "100%", objectFit: "cover", background: "#222", borderRadius: "12px" }); view = video;
          if (detector) timer = setInterval(async () => {
            try { const found = await detector.detect(video); if (found[0]) { result = { type: found[0].format, data: found[0].rawValue }; source = "real"; close(); } } catch { /* frame not ready */ }
          }, 300);
        }
        card.append(view, p(opts?.prompt ?? "Point the camera at a barcode"));
        card.append(btn("Cancel", () => { close(); }));
        // Without a detector (or without a real camera) the code the agent put in view is used, like a real scanner firing when it sees one.
        if (state.camera.barcode) setTimeout(() => { if (!result) { result = { ...state.camera.barcode! }; close(); } }, state.camera.delayMs ?? 800);
      });
      if (timer) clearInterval(timer); stopStream(stream);
      log("scan", result, source); return result;
    },
  },
  microphone: {
    async open() {
      if ((await askPermission("microphone")) !== "granted") throw new Error("Microphone permission denied");
      const stream = mayUseReal(state.source) ? await openStream({ audio: true }) : null;
      if (stream) {
        const meter = levelMeter(stream);
        log("microphone", { opened: true }, "real");
        return { source: "real" as const, stream, ...(meter ? { level: meter.level } : {}), stop: () => { meter?.close(); stopStream(stream); } };
      }
      log("microphone", { opened: true, level: state.microphone.level }); return { source: "simulated" as const, level: () => state.microphone.level, stop: () => {} };
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
        : n === "approve" ? { ok: true, receipt: `SIMULATED-${Date.now().toString(36).toUpperCase()}` } : n === "decline" ? { ok: false, reason: "declined" } : n === "cancel" ? { ok: false, reason: "cancelled" } : n === "timeout" ? { ok: false, reason: "timeout" } : n === "insufficient_funds" ? { ok: false, reason: "insufficient_funds" } : unknownNextResult(n);
      log("payment", { req, r }); return r;
    },
  },
  notifications: {
    async show(n) {
      if ((await askPermission("notifications")) !== "granted") return "";
      return deliver(n) ?? "";
    },
    onOpen(cb) { openSubs.add(cb); return () => { openSubs.delete(cb); }; },
    onTapped(cb) { openSubs.add(cb); return () => { openSubs.delete(cb); }; },
    onReceived(cb) { recvSubs.add(cb); return () => { recvSubs.delete(cb); }; },
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
  contacts: {
    async getAll() {
      if ((await askPermission("contacts")) !== "granted") throw new Error("Contacts permission denied");
      log("contacts", { count: state.contacts.length }); return state.contacts.map((c) => ({ ...c }));
    },
  },
  calendar: {
    async getEvents(range) {
      const from = new Date(range.start).getTime(), to = new Date(range.end).getTime();
      if (isNaN(from) || isNaN(to)) throw new Error("Calendar range needs valid start and end dates");
      if ((await askPermission("calendar")) !== "granted") throw new Error("Calendar permission denied");
      const found = state.calendar.filter((e) => new Date(e.start).getTime() < to && new Date(e.end).getTime() > from).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      log("calendar", { count: found.length }); return found.map((e) => ({ ...e }));
    },
  },
  files: {
    async pick(options) {
      const want = ([] as string[]).concat(options?.type ?? ["*/*"]).map((t) => t.toLowerCase());
      const ok = (m: string) => want.some((w) => w === "*/*" || w === "*" || w === m.toLowerCase() || (w.endsWith("/*") && m.toLowerCase().startsWith(w.slice(0, -1))));
      const offered = state.files.filter((f) => ok(f.mimeType));
      let chosen: DeviceState["files"][number] | null = null;
      await sheet("Choose a file", (card, close) => {
        if (offered.length === 0) card.append(p("No files"));
        for (const f of offered) card.append(btn(f.name, () => { chosen = f; close(); }));
        card.append(btn("Cancel", () => close()));
      });
      if (!chosen) { log("files", { picked: null }); return null; }
      const f = chosen as DeviceState["files"][number];
      const blob = new Blob([f.content], { type: f.mimeType });
      const out: PickedFile = { name: f.name, mimeType: f.mimeType, size: blob.size, uri: URL.createObjectURL(blob) };
      log("files", { picked: f.name }); return out;
    },
  },
  clipboard: { async set(t) { state.clipboard = t; }, async get() { return state.clipboard; } },
  net: { online: isOnline, type: connectionType, onChange(cb) { netSubs.add(cb); return () => { netSubs.delete(cb); }; } },
};

// A notification banner at the top, like a heads-up notification: tapping it opens the app's handler.
const recent: Notification[] = [];
let seq = 0;
/** Deliver a notification to the app. Returns its id, or null when notification permission is not granted (nothing reaches the app). */
function deliver(n: Omit<Notification, "id">): string | null {
  if (state.permissions.notifications !== "granted") { log("notification_blocked", { title: n.title, permission: state.permissions.notifications }); return null; }
  const full: Notification = { id: `n${Date.now().toString(36)}${(seq++).toString(36)}`, at: Date.now(), app: state.appName, ...n };
  // Do Not Disturb keeps the notification in the shade but shows no heads-up banner.
  showBanner(full, !state.dnd); log("notification", { ...full }); recvSubs.forEach((f) => f(full)); return full.id;
}
function showBanner(n: Notification, popup = true) {
  recent.push(n); if (recent.length > 20) recent.shift();
  if (!popup) return;
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
  set(patch: Partial<DeviceState>) { const before = statusKey(), bs = settingsKey(), sk = systemKey(), wasNet = netKey(); Object.assign(state, patch, { permissions: { ...state.permissions, ...(patch.permissions ?? {}) }, contacts: patch.contacts ? patch.contacts.map((c) => ({ ...c })) : state.contacts, calendar: patch.calendar ? patch.calendar.map((e) => ({ ...e })) : state.calendar, files: patch.files ? patch.files.map((f) => ({ ...f })) : state.files, camera: { ...state.camera, ...(patch.camera ?? {}) }, microphone: { ...state.microphone, ...(patch.microphone ?? {}) }, battery: { ...state.battery, ...(patch.battery ?? {}) }, biometrics: { ...state.biometrics, ...(patch.biometrics ?? {}) }, payment: { ...state.payment, ...(patch.payment ?? {}) } }); if (netKey() !== wasNet) netSubs.forEach((f) => f(isOnline())); announceSystem(sk); announceStatus(before, true, bs); },
  /** Push a notification to the app. Returns its id, or null when permission is not granted. */
  push(n: Omit<Notification, "id">) { return deliver(n); },
  log: () => state.log,
  /** Notifications delivered so far (the banner is gone after 5 s, like a heads-up on a phone; this is the notification shade). */
  notifications: () => recent.map((n) => ({ id: n.id, title: n.title, body: n.body, at: n.at, app: n.app, data: n.data })),
  /** Swipe one notification away (it stays in the log). False if there is no such notification. */
  dismiss(id: string) { const i = recent.findIndex((x) => x.id === id); if (i < 0) return false; recent.splice(i, 1); log("notification_dismissed", { id }); return true; },
  /** "Clear all". Returns how many were removed. */
  clearAll() { const n = recent.length; recent.length = 0; log("notifications_cleared", { count: n }); return n; },
  /** The quick-settings switches: Wi-Fi, mobile data, airplane, location, dark mode, Do Not Disturb, auto-rotate, flashlight, orientation lock, brightness. */
  settings,
  /** Dark mode, font size, bold text, reduce motion, language and RTL. */
  system,
  /** Tap a notification from the shade: same handler as tapping its banner. */
  openNotification(id?: string) { const n = id ? recent.find((x) => x.id === id) : recent[recent.length - 1]; if (!n) return false; document.querySelectorAll("[data-pn-banner]").forEach((e) => e.remove()); openSubs.forEach((f) => f(n)); log("notification_opened", { id: n.id }); return true; },
  /** Open a deep link: same path as openUrl. False when the app has no onUrl listener. */
  openUrl: (url: string): boolean | Promise<boolean> => deliverUrl(url),
  /** Deliver a share to the foreground app. */
  receiveShare: (p: SharePayload) => receiveShare(p),
  /** The share the app last made with `Share.share`, or null. */
  pendingShare: () => pendingShare,
  /** Set the URL `Linking.getInitialURL()` returns for this load. `null` clears it. */
  setInitialUrl(url: string | null) { initialUrl = url ?? null; },
  capabilities: () => device.capabilities(),
  /** What the status bar shows: network, airplane and battery. */
  status: () => ({ online: isOnline(), airplane: state.airplane, battery: { ...state.battery } }),
  /** Back to a known state: permissions undetermined, default location, nothing in front of the camera, log cleared. */
  reset(profile?: Partial<DeviceState>) {
    const before = statusKey(), bs = settingsKey(), sk = systemKey(), wasNet = netKey();
    Object.assign(state, { permissions: { camera: "undetermined", microphone: "undetermined", location: "undetermined", contacts: "undetermined", calendar: "undetermined", notifications: (profile?.platform ?? state.platform) === "android" && (profile?.api ?? state.api) < 33 ? "granted" : "undetermined" },
      source: "auto", microphone: { level: 0.2 }, location: { latitude: 4.0225, longitude: 9.6967, accuracy: 20 }, camera: { barcode: null, delayMs: 800 }, biometrics: { enrolled: true, nextResult: "success" }, payment: { nextResult: "approve", pin: "1234" }, online: true, networkProfile: "online", airplane: false, wifi: true, mobileData: true, locationServices: true, darkMode: false, dnd: false, autoRotate: true, flashlight: false, orientationLock: false, brightness: 70, fontSize: "default", boldText: false, reduceMotion: false, language: "en", rtl: false, battery: { level: 100, charging: false }, clipboard: "", contacts: [], calendar: [], files: [], log: [] }, profile ?? {});
    recent.length = 0; seq = 0; initialUrl = null; pendingShare = null;
    announceSystem(sk, false); announceStatus(before, false, bs); if (netKey() !== wasNet) netSubs.forEach((f) => f(isOnline()));
    for (const el of document.querySelectorAll("[data-pn-sheet],[data-pn-banner]")) el.remove();
  },
};
import("./system-settings").then((m) => m.installSystemSettings(g.__pnDevice)).catch(() => { /* no react-native here (tests, SSR) */ });
// Read by the `shipvo run` network client: the profile to apply, whether the phone is online, and where to log proxied calls.
g.__pnNet = { profile: () => state.networkProfile, online: () => isOnline(), log: (d: unknown) => log("net", d) };
export const simState = state;
export const simLog = log;
export const setOnline = (o: boolean) => g.__pnDevice.set({ online: o });
/** Call `cb` with each URL opened in the app (deep links). Returns an unsubscribe function. */
export const onUrl = (cb: (url: string) => void) => { urlSubs.add(cb); return () => { urlSubs.delete(cb); }; };
/** Deliver a URL to the app. Returns true if an `onUrl` listener received it. */
function deliverUrl(url: string): boolean | Promise<boolean> {
  // A web page opens in the phone's Browser app, not in the app. Only when the simulator provides one.
  // The simulator answers `{ ok: false, code }` (or throws) when it refuses the page, for example a private host.
  const browse = (g as { __pnOpenBrowser?: (u: string) => unknown }).__pnOpenBrowser;
  if (browse && /^https?:\/\//i.test(url)) {
    const refused = (code: unknown) => { log("browser_open_refused", { url, code: String(code ?? "error") }); return false; };
    let r: unknown;
    try { r = browse(url); } catch (e) { return refused((e as { code?: string }).code); }
    if (r && typeof (r as Promise<unknown>).then === "function") {
      return (r as Promise<{ ok?: boolean; code?: string } | undefined>).then((v) => {
        if (v && v.ok === false) return refused(v.code);
        log("browser_opened", { url }); return true;
      }, (e) => refused((e as { code?: string }).code));
    }
    log("browser_opened", { url }); return true;
  }
  // A link for another installed app: the simulator switches to that app and delivers it there (one-shot initial URL plus the url event).
  const hand = (g as { __pnOpenLink?: (u: string) => Promise<boolean> }).__pnOpenLink;
  if (hand) {
    return hand(url).then((took) => {
      if (took) { log("url_handoff", { url }); return true; }
      return deliverLocal(url);
    }, () => deliverLocal(url));
  }
  return deliverLocal(url);
}
function deliverLocal(url: string): boolean {
  window.dispatchEvent(new CustomEvent("pn:url", { detail: url }));
  urlSubs.forEach((f) => f(url)); log("url_opened", { url, handled: urlSubs.size > 0 });
  return urlSubs.size > 0;
}
export const openUrl = async (url: string) => { deliverUrl(url); };
let initialUrl: string | null = null;
export type SharePayload = { message?: string; url?: string };
export type PendingShare = { message: string | null; url: string | null; sourceApp: string; at: number };
let pendingShare: PendingShare | null = null;
/** The `Share` API of a phone. Records one pending share (a second call replaces it); the log entry is marked simulated. */
export const Share = {
  sharedAction: "sharedAction" as const,
  dismissedAction: "dismissedAction" as const,
  async share(content: SharePayload): Promise<{ action: "sharedAction" }> {
    pendingShare = { message: content.message ?? null, url: content.url ?? null, sourceApp: state.appName, at: Date.now() };
    log("share_recorded", { message: pendingShare.message, url: pendingShare.url, sourceApp: pendingShare.sourceApp });
    (g as { __pnShareRecorded?: (s: PendingShare) => unknown }).__pnShareRecorded?.(pendingShare);
    return { action: "sharedAction" };
  },
};
/** Hand a share to the app in the foreground: the one-shot `url` path of `openUrl` (listeners and the `pn:url` event), plus a `pn:share` event. With only a `message`, the `pn:share` event is the only notification, so listen for it. True if a listener took the url. */
export function receiveShare(p: SharePayload): boolean {
  window.dispatchEvent(new CustomEvent("pn:share", { detail: { message: p.message ?? null, url: p.url ?? null } }));
  log("share_received", { message: p.message ?? null, url: p.url ?? null });
  return p.url ? deliverLocal(p.url) : false;
}
/** The `Linking` API of a phone, backed by the simulated device. `openURL` goes through `openUrl`; its log entry is marked simulated. */
export const Linking = {
  async getInitialURL(): Promise<string | null> { return initialUrl; },
  addEventListener(type: "url", cb: (e: { url: string }) => void) { const f = (url: string) => cb({ url }); urlSubs.add(f); return { remove: () => { urlSubs.delete(f); } }; },
  async openURL(url: string): Promise<void> { await deliverUrl(url); },
};
// UI-owned bridges exist on native; on the simulated device the sheets are the UI, so they resolve immediately.
export const scanBridge = { subscribe: () => () => {}, current: () => null, finish: () => {} };
