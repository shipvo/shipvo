// Phone implementation: thin wrappers over Expo modules. Each module is optional so an app only pays for what it uses.
import { Platform, Share, Linking } from "react-native";
import type { Device, PermissionStatus, Notification } from "./types";
export * from "./types";

// Metro needs static requires; each module is optional so an app only pays for what it installs.
const tryReq = (f: () => any) => { try { return f(); } catch { return null; } };
const MODS: Record<string, any> = {
  "expo-camera": tryReq(() => require("expo-camera")),
  "expo-location": tryReq(() => require("expo-location")),
  "expo-local-authentication": tryReq(() => require("expo-local-authentication")),
  "expo-notifications": tryReq(() => require("expo-notifications")),
  "expo-clipboard": tryReq(() => require("expo-clipboard")),
};
function opt<T>(name: string): T | null { return (MODS[name] as T) ?? null; }
const map = (s: string): PermissionStatus => (s === "granted" ? "granted" : s === "denied" ? "denied" : "undetermined");
let online = true; const netSubs = new Set<(o: boolean) => void>();

export const device: Device = {
  kind: "native",
  capabilities: () => ({
    camera: MODS["expo-camera"] ? "real" : "unavailable", location: MODS["expo-location"] ? "real" : "unavailable",
    biometrics: MODS["expo-local-authentication"] ? "real" : "unavailable", notifications: MODS["expo-notifications"] ? "real" : "unavailable",
    clipboard: MODS["expo-clipboard"] ? "real" : "unavailable", share: "real", network: "real",
    payments: "simulated", // sandbox provider until a gateway is configured: receipts are prefixed SANDBOX-
  }),
  permissions: {
    async get(name) {
      if (name === "camera") { const C = opt<any>("expo-camera"); return C ? map((await C.Camera.getCameraPermissionsAsync()).status) : "denied"; }
      if (name === "location") { const L = opt<any>("expo-location"); return L ? map((await L.getForegroundPermissionsAsync()).status) : "denied"; }
      const N = opt<any>("expo-notifications"); return N ? map((await N.getPermissionsAsync()).status) : "denied";
    },
    async request(name) {
      if (name === "camera") { const C = opt<any>("expo-camera"); return C ? map((await C.Camera.requestCameraPermissionsAsync()).status) : "denied"; }
      if (name === "location") { const L = opt<any>("expo-location"); return L ? map((await L.requestForegroundPermissionsAsync()).status) : "denied"; }
      const N = opt<any>("expo-notifications"); return N ? map((await N.requestPermissionsAsync()).status) : "denied";
    },
  },
  location: {
    async current() {
      const L = opt<any>("expo-location"); if (!L) throw new Error("expo-location is not installed");
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
    onOpen(cb) {
      const N = opt<any>("expo-notifications"); if (!N) return () => {};
      const sub = N.addNotificationResponseReceivedListener((r: any) => { const c = r.notification.request.content; cb({ id: r.notification.request.identifier, title: c.title ?? "", body: c.body ?? "", data: c.data }); });
      return () => sub.remove();
    },
  },
  share: { async text(text, title) { try { const r = await Share.share(Platform.OS === "ios" ? { message: text, title } : { message: text, title }); return r.action !== Share.dismissedAction; } catch { return false; } } },
  clipboard: {
    async set(text) { const C = opt<any>("expo-clipboard"); if (C) await C.setStringAsync(text); },
    async get() { const C = opt<any>("expo-clipboard"); return C ? C.getStringAsync() : ""; },
  },
  net: { online: () => online, onChange(cb) { netSubs.add(cb); return () => { netSubs.delete(cb); }; } },
};
export const setOnline = (o: boolean) => { online = o; netSubs.forEach((f) => f(o)); };
export const openUrl = (url: string) => Linking.openURL(url);

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
