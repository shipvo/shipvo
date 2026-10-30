import { requireNativeModule } from "expo-modules-core";

export type RuntimeState = {
  cohort: number; band: "b0" | "b1" | "b2";
  runningRelease: number; currentRelease: number; pendingRelease: number; previousRelease: number;
  baseUrl: string; appId: string; shellMajor: number;
};
export type CheckResult = {
  status: "none" | "staged" | "error"; release?: number; bytes?: number; downloadMs?: number; verifyMs?: number;
  issuedAt?: string; error?: string;
};
export type HealthyResult = { release: number; coldStartMs: number; sinceLoadMs: number; promoted: boolean };

type Native = {
  getState(): RuntimeState;
  checkForUpdate(apply: boolean): Promise<CheckResult>;
  markHealthy(): HealthyResult;
  consumeEvents(): string[];
  rollback(): void;
  reload(): void;
};

export const Runtime: Native = requireNativeModule("PureNativeRuntime");
