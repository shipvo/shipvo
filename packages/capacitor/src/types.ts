export type Band = "b0" | "b1" | "b2";

/** Same shape as `RuntimeState` in `@shipvo/runtime`. */
export type RuntimeState = {
  cohort: number; band: Band;
  runningRelease: number; currentRelease: number; pendingRelease: number; previousRelease: number;
  blockedRelease?: number; shellVersion?: string;
  baseUrl: string; appId: string; shellMajor: number;
};
export type CheckResult = {
  status: "none" | "staged" | "error"; release?: number; bytes?: number; downloadMs?: number; verifyMs?: number;
  issuedAt?: string; error?: string;
  reason?: "hermes_bytecode_mismatch" | "native_module_missing" | "native_module_version";
};
export type HealthyResult = { release: number; coldStartMs: number; sinceLoadMs: number; promoted: boolean; kind?: "cold" | "reload" };

/** The plugin the Capacitor app calls. Same methods as `Native` in `packages/runtime/src/index.ts`; every call is async because Capacitor bridges are. */
export interface ShipvoCapacitorPlugin {
  getState(): Promise<RuntimeState>;
  checkForUpdate(options: { apply: boolean }): Promise<CheckResult>;
  markHealthy(): Promise<HealthyResult>;
  consumeEvents(): Promise<{ events: string[] }>;
  rollback(): Promise<void>;
  reload(): Promise<void>;
}

/** Small key-value store. The native layer backs it with SharedPreferences / UserDefaults. */
export interface KeyValueStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}
/** Bundle files. The native layer backs it with the app's private files directory. */
export interface BundleFiles {
  write(name: string, bytes: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
  /** Remove every file. Used when a new shell is installed. */
  clear(): Promise<void>;
}
