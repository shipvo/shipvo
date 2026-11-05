import type { BundleFiles, KeyValueStore } from "./types.js";

export class MemoryStore implements KeyValueStore {
  readonly map = new Map<string, string>();
  async get(k: string) { return this.map.get(k); }
  async set(k: string, v: string) { this.map.set(k, v); }
}
export class MemoryFiles implements BundleFiles {
  readonly files = new Map<string, Uint8Array>();
  async write(n: string, b: Uint8Array) { this.files.set(n, b); }
  async remove(n: string) { this.files.delete(n); }
  async clear() { this.files.clear(); }
}
