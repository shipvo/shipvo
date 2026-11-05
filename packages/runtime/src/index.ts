import { requireOptionalNativeModule } from "expo-modules-core";

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
  /** Set with status "none" when a release was refused. "hermes_bytecode_mismatch": built for another Hermes bytecode version than this shell runs. */
  reason?: "hermes_bytecode_mismatch";
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

// After markHealthy, tell the native side about an uncaught JS error before React destroys the host. Destroying the host
// pauses the activity, and that pause must not count as "stable". Needs a shell with `noteCrash`; older shells skip it.
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

// Every `Native` method must be listed here, or it is silently dropped from `Runtime`.
export const Runtime: Native = native
  ? {
      getState: () => native.getState(),
      checkForUpdate: (apply) => native.checkForUpdate(apply),
      markHealthy: () => { const r = native.markHealthy(); installCrashHook(); return r; },
      consumeEvents: () => native.consumeEvents(),
      rollback: () => native.rollback(),
      reload: () => native.reload(),
    }
  : fallback;
