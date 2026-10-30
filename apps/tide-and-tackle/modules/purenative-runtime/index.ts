import { requireOptionalNativeModule } from "expo-modules-core";

export type RuntimeState = {
  cohort: number; band: "b0" | "b1" | "b2";
  runningRelease: number; currentRelease: number; pendingRelease: number; previousRelease: number;
  blockedRelease?: number; shellVersion?: string;
  baseUrl: string; appId: string; shellMajor: number;
};
export type CheckResult = {
  status: "none" | "staged" | "error"; release?: number; bytes?: number; downloadMs?: number; verifyMs?: number;
  /** Shell 1.0.2+: "patch" when a bsdiff patch was applied, "full" otherwise. */
  via?: "patch" | "full"; bundleBytes?: number; patchError?: string | null;
  issuedAt?: string; error?: string;
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

// The runtime is Android-only for now. On iOS (and the simulator) the app runs on its embedded bundle and live content.
const t0 = Date.now();
const fallback: Native = {
  getState: () => ({ cohort: 0, band: "b0", runningRelease: 0, currentRelease: 0, pendingRelease: 0, previousRelease: 0,
    shellVersion: "no-runtime", baseUrl: "https://purenative-control.purenative.workers.dev", appId: "tide", shellMajor: 1 }),
  checkForUpdate: async () => ({ status: "none" }),
  markHealthy: () => ({ release: 0, coldStartMs: Date.now() - t0, sinceLoadMs: 0, promoted: false, kind: "cold" }),
  consumeEvents: () => [], rollback: () => {}, reload: () => {},
};
export const Runtime: Native = requireOptionalNativeModule<Native>("ShipvoRuntime") ?? fallback;
