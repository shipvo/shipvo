// Simulator (web) stand-in for the native runtime: no OTA, no device. The simulator can point content at a
// control plane by setting globalThis.__PN_SIM__ = { baseUrl, appId } before the app loads.
import type { CheckResult, HealthyResult, RuntimeState } from "./index";
export type { CheckResult, HealthyResult, RuntimeState } from "./index";

const sim = (globalThis as any).__PN_SIM__ ?? {};
const t0 = Date.now();
export const Runtime = {
  getState(): RuntimeState {
    return { cohort: 0, band: "b0", runningRelease: 0, currentRelease: 0, pendingRelease: 0, previousRelease: 0,
      shellVersion: "simulator", baseUrl: sim.baseUrl ?? "", appId: sim.appId ?? "tide", shellMajor: 1 };
  },
  async checkForUpdate(_apply: boolean): Promise<CheckResult> { return { status: "none" }; },
  markHealthy(): HealthyResult { return { release: 0, coldStartMs: Date.now() - t0, sinceLoadMs: 0, promoted: false, kind: "cold" }; },
  consumeEvents(): string[] { return []; },
  rollback(): void {},
  reload(): void { (globalThis as any).location?.reload(); },
};
