import { requireOptionalNativeModule } from "expo-modules-core";
import { forwardRuntimeEvents, FORWARDED_EVENTS, type ForwardedEvent } from "./runtimeEvents";

import { ensureInstallIdentity, signReport, webCrypto, type InstallIdentity, type TelemetryCrypto, type TelemetryStorage } from "./install";

export { forwardRuntimeEvents, FORWARDED_EVENTS, ensureInstallIdentity, signReport, webCrypto };
export type { InstallIdentity, TelemetryCrypto, TelemetryStorage };
export type { ForwardedEvent };

export type RuntimeState = {
  cohort: number; band: "b0" | "b1" | "b2";
  runningRelease: number; currentRelease: number; pendingRelease: number; previousRelease: number;
  blockedRelease?: number; shellVersion?: string;
  baseUrl: string; appId: string; shellMajor: number;
};
export type CheckResult = {
  status: "none" | "staged" | "error"; release?: number; bytes?: number; downloadMs?: number; verifyMs?: number;
  /** Shell 1.0.2+ (Android): "patch" when a bsdiff patch was applied, "full" otherwise. iOS always downloads "full". */
  via?: "patch" | "full"; bundleBytes?: number; patchError?: string | null;
  issuedAt?: string; error?: string;
  /** Android only for now: why a "none" result happened when the control plane rejected the shell's bytecode or native modules. */
  reason?: "hermes_bytecode_mismatch" | "native_module_missing" | "native_module_version";
};
export type HealthyResult = {
  release: number; coldStartMs: number; sinceLoadMs: number; promoted: boolean;
  /** Set by shell 1.0.1+: "cold" = first bundle load in this process, "reload" = applied without restart. */
  kind?: "cold" | "reload";
};

type Native = {
  getState(): RuntimeState;
  checkForUpdate(apply: boolean): Promise<CheckResult>;
  markHealthy(): HealthyResult;
  consumeEvents(): string[];
  rollback(): void;
  reload(): void;
};

// The native runtime exists on Android and iOS. Where the module is missing (web, Expo Go, a shell built without it) the
// app runs its embedded bundle and live content, and still knows its control plane and app id from expo.extra.shipvo.
const t0 = Date.now();
let extra: any = {};
try { extra = require("expo-constants").default?.expoConfig?.extra?.shipvo ?? {}; } catch {}
const fallback: Native = {
  getState: () => ({ cohort: 0, band: "b0", runningRelease: 0, currentRelease: 0, pendingRelease: 0, previousRelease: 0,
    shellVersion: "no-runtime", baseUrl: extra.baseUrl ?? "", appId: extra.appId ?? "", shellMajor: extra.shellMajor ?? 1 }),
  checkForUpdate: async () => ({ status: "none" }),
  markHealthy: () => ({ release: 0, coldStartMs: Date.now() - t0, sinceLoadMs: 0, promoted: false, kind: "cold" }),
  consumeEvents: () => [], rollback: () => {}, reload: () => {},
};
const native = requireOptionalNativeModule<Native & { noteCrash?(): void }>("ShipvoRuntime");

// Tell the native side about an uncaught JS error before React destroys the host. Destroying the host
// pauses the activity, and that pause must not count as "stable". It also lets a background load that throws count against
// its release, and that load never reaches markHealthy, so the hook is installed when the module loads. Needs a shell with `noteCrash`; older shells skip it.
let crashHookInstalled = false;
function installCrashHook() {
  if (crashHookInstalled || typeof native?.noteCrash !== "function") return;
  const eu = (globalThis as any).ErrorUtils;
  if (!eu?.setGlobalHandler || !eu.getGlobalHandler) return;
  crashHookInstalled = true;
  const prev = eu.getGlobalHandler();
  eu.setGlobalHandler((e: unknown, isFatal?: boolean) => {
    if (isFatal) { try { native.noteCrash!(); } catch {} }
    prev?.(e, isFatal);
  });
}
installCrashHook();

let identity: InstallIdentity | null = null;
let identityCrypto: TelemetryCrypto = webCrypto;
/**
 * Turn on signed telemetry. Registers this install once (see `ensureInstallIdentity`); until that finishes, and if it
 * fails, reports are sent unsigned. Pass your own `crypto` on React Native. Never throws. The identity is module-global:
 * calling this again replaces the previous identity and crypto.
 */
export async function enableSignedTelemetry(opts: { storage: TelemetryStorage; registerUrl: string; crypto?: TelemetryCrypto }): Promise<InstallIdentity | null> {
  identityCrypto = opts.crypto ?? webCrypto;
  identity = await ensureInstallIdentity(opts.storage, identityCrypto, opts.registerUrl);
  return identity;
}

const listeners = new Set<(events: string[]) => void>();
/** Called with every batch of queued events the runtime drains, in `reportRuntimeEvents`. Returns an unsubscribe function. */
export function onRuntimeEvents(fn: (events: string[]) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Drain the device's event queue and send each forwarded event to the control plane (`POST {baseUrl}/t`), using
 * `baseUrl` and `appId` from the native state or `expo.extra.shipvo`. Best effort: it never throws, a failed send
 * never blocks the others, and nothing is sent without a `baseUrl`. Returns the drained event strings.
 * `Runtime.markHealthy` and `Runtime.checkForUpdate` call this for you. Set `extra.shipvo.reportEvents` to `false`
 * to turn that off.
 */
export function reportRuntimeEvents(): string[] {
  let events: string[] = [];
  try { events = native ? native.consumeEvents() : []; } catch { return []; }
  if (!Array.isArray(events) || events.length === 0) return [];
  for (const l of listeners) { try { l(events); } catch {} }
  let state: Partial<RuntimeState> = {};
  try { state = (native ?? fallback).getState() ?? {}; } catch {}
  const baseUrl = state.baseUrl || extra.baseUrl;
  const appId = state.appId || extra.appId;
  if (!baseUrl || !appId) return events;
  let androidApi: number | undefined;
  try {
    const rn = require("react-native");
    if (rn.Platform?.OS === "android" && typeof rn.Platform.Version === "number") androidApi = rn.Platform.Version;
  } catch {}
  forwardRuntimeEvents(events, (event, release, loadKind) => {
    try {
      // Same payload the sample app sent before this moved here: device_class is fixed to "low", android_api is set on Android only.
      const body = { schema_version: "1.0", app_id: appId, release: release ?? state.runningRelease ?? 0, event,
        device_class: "low", android_api: androidApi, ...(loadKind ? { load_kind: loadKind } : {}) };
      const post = (b: string) => Promise.resolve(fetch(`${baseUrl}/t`, { method: "POST", headers: { "content-type": "application/json" },
        body: b })).catch(() => {});
      const id = identity;
      if (!id) { post(JSON.stringify(body)); return; }
      const plain = JSON.stringify(body);
      // `sig` is the HMAC of `signed`, closing `}` included. We send `signed` with that `}` replaced by
      // `,"sig":"<hex>"}`. The server cuts that suffix, appends `}` and checks the HMAC. If signing fails, send unsigned.
      const signed = JSON.stringify({ ...body, install_id: id.install_id });
      signReport(id, signed, identityCrypto).then(
        (r) => post(`${signed.slice(0, -1)},"sig":"${r.sig}"}`),
        () => post(plain));
    } catch {}
  });
  return events;
}

const autoReport = () => { if (extra.reportEvents !== false) reportRuntimeEvents(); };

// Every `Native` method must be listed here, or it is silently dropped from `Runtime`.
export const Runtime: Native = native
  ? {
      getState: () => native.getState(),
      checkForUpdate: async (apply) => { try { return await native.checkForUpdate(apply); } finally { autoReport(); } },
      markHealthy: () => { const r = native.markHealthy(); installCrashHook(); autoReport(); return r; },
      consumeEvents: () => native.consumeEvents(),
      rollback: () => native.rollback(),
      reload: () => native.reload(),
    }
  : fallback;
