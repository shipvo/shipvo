import type { ShipvoCapacitor } from "./engine.js";
import type { BundleFiles, KeyValueStore } from "./types.js";

/** The methods the native plugin (`android/` and `ios/`, plugin name `Shipvo`) exposes through the Capacitor bridge. Binary data travels as base64. */
export interface ShipvoNativePlugin {
  kvGet(o: { key: string }): Promise<{ value?: string }>;
  kvSet(o: { key: string; value: string }): Promise<void>;
  fileWrite(o: { name: string; data: string }): Promise<void>;
  fileRead(o: { name: string }): Promise<{ data: string }>;
  fileRemove(o: { name: string }): Promise<void>;
  fileList(): Promise<{ names: string[] }>;
  fileClear(): Promise<void>;
  /** Unpack the stored bundle and point the web view at it. Native re-checks `sha256` first. */
  serve(o: { name: string; sha256: string }): Promise<void>;
  /** The bundle this process already serves, if any. */
  status(): Promise<{ serving?: string }>;
}

const toB64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));

/** `KeyValueStore` backed by the native plugin (SharedPreferences on Android, UserDefaults on iOS). */
export class NativeStore implements KeyValueStore {
  constructor(private n: ShipvoNativePlugin) {}
  async get(key: string) { return (await this.n.kvGet({ key })).value; }
  async set(key: string, value: string) { await this.n.kvSet({ key, value }); }
}

/** `BundleFiles` backed by the native plugin (the app-private files directory on Android, Application Support on iOS). */
export class NativeFiles implements BundleFiles {
  constructor(private n: ShipvoNativePlugin) {}
  async write(name: string, bytes: Uint8Array) { await this.n.fileWrite({ name, data: toB64(bytes) }); }
  async read(name: string) { return fromB64((await this.n.fileRead({ name })).data); }
  async remove(name: string) { await this.n.fileRemove({ name }); }
  async list() { return (await this.n.fileList()).names; }
  async clear() { await this.n.fileClear(); }
}

/**
 * Run this first when the page loads. It asks the core which release to serve (`boot()`, which also
 * decides rollback) and tells the native layer to serve that file. Native never picks a bundle on its own.
 * Returns `served: true` when the web view is on a staged bundle.
 */
export async function bootAndServe(shipvo: ShipvoCapacitor, native: ShipvoNativePlugin): Promise<{ release: number; served: boolean; error?: string }> {
  const { serving } = await native.status();
  if (serving) {
    // This page was loaded by an earlier `serve` in this process: `boot()` already ran.
    const release = Number(/^release-(\d+)\.bundle$/.exec(serving)?.[1] ?? 0);
    await shipvo.resume(release);
    return { release, served: true };
  }
  return bootAndSwitch(shipvo, native);
}

/** Run `boot()` and serve its choice now. Use it as `onReload` so `checkForUpdate({ apply: true })` switches the web view. */
export async function bootAndSwitch(shipvo: ShipvoCapacitor, native: ShipvoNativePlugin): Promise<{ release: number; served: boolean; error?: string }> {
  const { release, file } = await shipvo.boot();
  if (!file) return { release: 0, served: false };
  const sha256 = await shipvo.bundleHash(release);
  if (!sha256) return { release, served: false, error: "no verified hash for the stored bundle" };
  try { await native.serve({ name: file, sha256 }); } catch (e) { return { release, served: false, error: String((e as Error)?.message ?? e) }; }
  return { release, served: true };
}
