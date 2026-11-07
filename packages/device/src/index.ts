// Phone implementation: thin wrappers over Expo modules. Each module is optional so an app only pays for what it uses.
import { Platform, Share, Linking } from "react-native";
import type { Device, PermissionStatus, Notification, Contact, CalendarEvent, PickedFile } from "./types";
export * from "./types";

// Metro resolves require() statically and only treats it as optional when it sits directly inside a try block
// (not inside a function). So each module gets its own try/catch: a missing module resolves to null, and the bundle still builds.
const MODS: Record<string, any> = {};
try { MODS["expo-camera"] = require("expo-camera"); } catch { MODS["expo-camera"] = null; }
try { MODS["expo-location"] = require("expo-location"); } catch { MODS["expo-location"] = null; }
try { MODS["expo-local-authentication"] = require("expo-local-authentication"); } catch { MODS["expo-local-authentication"] = null; }
try { MODS["expo-notifications"] = require("expo-notifications"); } catch { MODS["expo-notifications"] = null; }
try { MODS["expo-clipboard"] = require("expo-clipboard"); } catch { MODS["expo-clipboard"] = null; }
try { MODS["expo-contacts"] = require("expo-contacts"); } catch { MODS["expo-contacts"] = null; }
try { MODS["expo-calendar"] = require("expo-calendar"); } catch { MODS["expo-calendar"] = null; }
try { MODS["expo-document-picker"] = require("expo-document-picker"); } catch { MODS["expo-document-picker"] = null; }
function opt<T>(name: string): T | null { return (MODS[name] as T) ?? null; }
const map = (s: string): PermissionStatus => (s === "granted" ? "granted" : s === "denied" ? "denied" : "undetermined");
let online = true; const netSubs = new Set<(o: boolean) => void>();

export const device: Device = {
  kind: "native",
  capabilities: () => ({
    camera: MODS["expo-camera"] ? "real" : "unavailable", location: MODS["expo-location"] ? "real" : "unavailable",
    biometrics: MODS["expo-local-authentication"] ? "real" : "unavailable", notifications: MODS["expo-notifications"] ? "real" : "unavailable",
    clipboard: MODS["expo-clipboard"] ? "real" : "unavailable", contacts: MODS["expo-contacts"] ? "real" : "unavailable", calendar: MODS["expo-calendar"] ? "real" : "unavailable", files: MODS["expo-document-picker"] ? "real" : "unavailable", share: "real", network: "real",
    microphone: "unavailable",
    payments: "simulated", // sandbox provider until a gateway is configured: receipts are prefixed SANDBOX-
  }),
  permissions: {
    async get(name) {
      if (name === "microphone") return "denied"; // the microphone API is web and simulator only
      if (name === "camera") { const C = opt<any>("expo-camera"); return C ? map((await C.Camera.getCameraPermissionsAsync()).status) : "denied"; }
      if (name === "location") { const L = opt<any>("expo-location"); return L ? map((await L.getForegroundPermissionsAsync()).status) : "denied"; }
      if (name === "contacts") { const K = opt<any>("expo-contacts"); return K ? map((await K.getPermissionsAsync()).status) : "denied"; }
      if (name === "calendar") { const K = opt<any>("expo-calendar"); return K ? map((await K.getCalendarPermissionsAsync()).status) : "denied"; }
      const N = opt<any>("expo-notifications"); return N ? map((await N.getPermissionsAsync()).status) : "denied";
    },
    async request(name) {
      if (name === "microphone") return "denied";
      if (name === "camera") { const C = opt<any>("expo-camera"); return C ? map((await C.Camera.requestCameraPermissionsAsync()).status) : "denied"; }
      if (name === "location") { const L = opt<any>("expo-location"); return L ? map((await L.requestForegroundPermissionsAsync()).status) : "denied"; }
      if (name === "contacts") { const K = opt<any>("expo-contacts"); return K ? map((await K.requestPermissionsAsync()).status) : "denied"; }
      if (name === "calendar") { const K = opt<any>("expo-calendar"); return K ? map((await K.requestCalendarPermissionsAsync()).status) : "denied"; }
      const N = opt<any>("expo-notifications"); return N ? map((await N.requestPermissionsAsync()).status) : "denied";
    },
  },
  location: {
    async current() {
      const L = opt<any>("expo-location"); if (!L) throw new Error("expo-location is not installed");
      // Ask first, like the system flow on a phone: without this the read fails silently and no dialog is ever shown.
      let st = (await L.getForegroundPermissionsAsync()).status;
      if (st !== "granted") st = (await L.requestForegroundPermissionsAsync()).status;
      if (st !== "granted") throw new Error("Location permission denied");
      const p = await L.getCurrentPositionAsync({ accuracy: L.Accuracy.Balanced });
      return { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy ?? undefined };
    },
  },
  camera: {
    // The scanner screen is UI; apps mount <ScanScreen> from "@shipvo/device/scan" and this resolves when it reports.
    scan: (opts) => scanBridge.open(opts?.prompt),
  },
  auth: {
    async available() { const A = opt<any>("expo-local-authentication"); return !!A && (await A.hasHardwareAsync()) && (await A.isEnrolledAsync()); },
    async confirm(reason) {
      const A = opt<any>("expo-local-authentication"); if (!A) return { ok: false, reason: "unavailable" };
      if (!(await A.hasHardwareAsync())) return { ok: false, reason: "unavailable" };
      if (!(await A.isEnrolledAsync())) return { ok: false, reason: "not_enrolled" };
      const r = await A.authenticateAsync({ promptMessage: reason, cancelLabel: "Cancel", disableDeviceFallback: false });
      return r.success ? { ok: true } : { ok: false, reason: r.error === "user_cancel" || r.error === "system_cancel" ? "cancelled" : "failed" };
    },
  },
  pay: {
    // Sandbox provider until a real mobile-money or card gateway is configured: approves PIN 1234, declines others.
    async charge(req, pin) { await new Promise((r) => setTimeout(r, 900)); return pin === "1234" ? { ok: true, receipt: `SANDBOX-${Date.now().toString(36).toUpperCase()}` } : { ok: false, reason: "declined" }; },
  },
  notifications: {
    async show(n) {
      const N = opt<any>("expo-notifications"); if (!N) return "";
      return N.scheduleNotificationAsync({ content: { title: n.title, body: n.body, data: n.data ?? {} }, trigger: null });
    },
    onOpen(cb) { return device.notifications.onTapped(cb); },
    onTapped(cb) {
      const N = opt<any>("expo-notifications"); if (!N) return () => {};
      const sub = N.addNotificationResponseReceivedListener((r: any) => { const c = r.notification.request.content; cb({ id: r.notification.request.identifier, title: c.title ?? "", body: c.body ?? "", data: c.data }); });
      return () => sub.remove();
    },
    onReceived(cb) {
      const N = opt<any>("expo-notifications"); if (!N) return () => {};
      const sub = N.addNotificationReceivedListener((n: any) => { const c = n.request.content; cb({ id: n.request.identifier, title: c.title ?? "", body: c.body ?? "", data: c.data }); });
      return () => sub.remove();
    },
  },
  share: { async text(text, title) { try { const r = await Share.share(Platform.OS === "ios" ? { message: text, title } : { message: text, title }); return r.action !== Share.dismissedAction; } catch { return false; } } },
  contacts: {
    async getAll() {
      const K = opt<any>("expo-contacts"); if (!K) throw new Error("expo-contacts is not installed");
      let st = (await K.getPermissionsAsync()).status;
      if (st !== "granted") st = (await K.requestPermissionsAsync()).status;
      if (st !== "granted") throw new Error("Contacts permission denied");
      const r = await K.getContactsAsync({ fields: [K.Fields.PhoneNumbers, K.Fields.Emails] });
      return (r.data as any[]).map((c): Contact => ({ id: String(c.id), name: c.name ?? "", phoneNumbers: (c.phoneNumbers ?? []).map((p: any) => p.number), emails: (c.emails ?? []).map((e: any) => e.email) }));
    },
  },
  calendar: {
    async getEvents(range) {
      const K = opt<any>("expo-calendar"); if (!K) throw new Error("expo-calendar is not installed");
      const from = new Date(range.start), to = new Date(range.end);
      if (isNaN(from.getTime()) || isNaN(to.getTime())) throw new Error("Calendar range needs valid start and end dates");
      let st = (await K.getCalendarPermissionsAsync()).status;
      if (st !== "granted") st = (await K.requestCalendarPermissionsAsync()).status;
      if (st !== "granted") throw new Error("Calendar permission denied");
      const cals = (await K.getCalendarsAsync(K.EntityTypes.EVENT)) as any[];
      if (cals.length === 0) return [];
      const evs = (await K.getEventsAsync(cals.map((c) => c.id), from, to)) as any[];
      const iso = (v: any) => new Date(v).toISOString();
      return evs.map((e): CalendarEvent => ({ id: String(e.id), title: e.title ?? "", start: iso(e.startDate), end: iso(e.endDate), allDay: !!e.allDay, location: e.location ?? undefined, notes: e.notes ?? undefined }))
        .sort((a, b) => a.start.localeCompare(b.start));
    },
  },
  files: {
    async pick(options) {
      const K = opt<any>("expo-document-picker"); if (!K) throw new Error("expo-document-picker is not installed");
      const r = await K.getDocumentAsync({ type: options?.type ?? "*/*", copyToCacheDirectory: true, multiple: false });
      if (r.canceled || !r.assets?.length) return null;
      const a = r.assets[0];
      return { name: a.name ?? "", mimeType: a.mimeType ?? "application/octet-stream", size: a.size ?? 0, uri: a.uri } as PickedFile;
    },
  },
  clipboard: {
    async set(text) { const C = opt<any>("expo-clipboard"); if (C) await C.setStringAsync(text); },
    async get() { const C = opt<any>("expo-clipboard"); return C ? C.getStringAsync() : ""; },
  },
  net: { online: () => online, onChange(cb) { netSubs.add(cb); return () => { netSubs.delete(cb); }; } },
};
export const setOnline = (o: boolean) => { online = o; netSubs.forEach((f) => f(o)); };
export const openUrl = (url: string) => Linking.openURL(url);
/** Call `cb` with each URL opened in the app (deep links). Returns an unsubscribe function. */
/** The URL that launched the app, or null. */
export const getInitialUrl = (): Promise<string | null> => Linking.getInitialURL();
export const onUrl = (cb: (url: string) => void) => { const s = Linking.addEventListener("url", (e) => cb(e.url)); return () => s.remove(); };

// Bridges: UI-owned flows (scanner, payment prompt) resolve a promise when the screen reports back.
function bridge<Req, Res>() {
  let pending: { req: Req; resolve: (r: Res) => void } | null = null; const subs = new Set<() => void>();
  return {
    open(req: Req) { return new Promise<Res>((resolve) => { pending = { req, resolve }; subs.forEach((f) => f()); }); },
    current: () => pending?.req ?? null,
    finish(res: Res) { const p = pending; pending = null; subs.forEach((f) => f()); p?.resolve(res); },
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  };
}
export const scanBridge = bridge<string | undefined, import("./types").ScanResult | null>();
export type { Notification };
