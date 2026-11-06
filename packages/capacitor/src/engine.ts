import { ReleasePointerBody, SignedEnvelope, bandForCohort } from "@shipvo/schema";
import type { BundleFiles, CheckResult, HealthyResult, KeyValueStore, RuntimeState, ShipvoCapacitorPlugin } from "./types.js";
import { semverLess, sha256Hex, verifyEd25519 } from "./verify.js";

export const MAX_BOOTS = 3;
export const WINDOW_MS = 60_000;

export type ShipvoConfig = {
  appId: string; shellMajor: number;
  /** Installed app version, x.y.z. */
  shellVersion: string;
  platform: "android" | "ios";
  /** Ed25519 public key (base64), baked into the shell. Never read from the network. */
  publicKey: string;
  baseUrl: string;
  store: KeyValueStore; files: BundleFiles;
  fetch?: typeof fetch; now?: () => number; random?: () => number;
  /** Called by `reload`: the native layer points the web view at the chosen bundle. */
  onReload?: () => void | Promise<void>;
};

type Saved = {
  shellVersion: string; cohort: number;
  current: number; pending: number; previous: number; blocked: number;
  pendingBoots: number; bootTimes: number[]; events: string[];
  /** sha-256 of each stored release's archive, for the native layer to re-check at load. */
  hashes: Record<string, string>;
};

const KEY = "shipvo.state";
export const bundleName = (release: number) => `release-${release}.bundle`;

/** Release decisions for a signed web bundle. Rules are numbered as in docs/adapters.md. */
export class ShipvoCapacitor implements ShipvoCapacitorPlugin {
  private s?: Saved;
  private running = 0;
  private loadedAt: number;
  private firstLoad = true;
  private readonly t0: number;
  constructor(private c: ShipvoConfig) { this.t0 = this.loadedAt = this.now(); }

  private now() { return (this.c.now ?? Date.now)(); }
  private loading?: Promise<Saved>;
  private lock: Promise<unknown> = Promise.resolve();
  /** Runs `fn` after every earlier locked call has finished, so check, markHealthy and rollback never overlap. */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }
  /** One load for all callers: concurrent first calls share the same state object. */
  private load(): Promise<Saved> {
    if (!this.loading) {
      this.loading = this.doLoad().catch((e) => { this.loading = undefined; throw e; });
    }
    return this.loading;
  }
  private async doLoad(): Promise<Saved> {
    let s: Saved | undefined; let corrupt = false;
    try { const raw = await this.c.store.get(KEY); if (raw) s = JSON.parse(raw); } catch { s = undefined; corrupt = true; }
    if (corrupt) await this.c.files.clear();
    if (!s) {
      const cohort = Math.min(999, Math.floor((this.c.random ?? Math.random)() * 1000));
      s = { shellVersion: this.c.shellVersion, cohort, current: 0, pending: 0, previous: 0, blocked: 0, pendingBoots: 0, bootTimes: [], events: [], hashes: {} };
    } else if (s.shellVersion !== this.c.shellVersion) {
      // Rule 13: a new shell deletes stored bundles and counters. The cohort stays.
      await this.c.files.clear();
      s = { ...s, shellVersion: this.c.shellVersion, current: 0, pending: 0, previous: 0, blocked: 0, pendingBoots: 0, bootTimes: [], hashes: {} };
    }
    this.s = s; await this.save(); return s;
  }
  private async save() { await this.c.store.set(KEY, JSON.stringify(this.s)); }
  private async drop(release: number) {
    if (!release || !this.s) return;
    delete this.s.hashes[String(release)];
    await this.c.files.remove(bundleName(release));
  }
  private block(s: Saved, release: number) { s.blocked = Math.max(s.blocked, release); }

  /**
   * Called by the native layer each time the web view loads. Picks the release to serve (rules 10, 11):
   * pending for up to 3 trial boots, else current, else the embedded bundle (release 0).
   * Returns the release and the file name to serve, or `file: undefined` for the embedded bundle.
   */
  async boot(): Promise<{ release: number; file?: string }> {
    const s = await this.load(); const now = this.now();
    if (s.pending) {
      if (s.pendingBoots >= MAX_BOOTS) {
        // Rule 10: three trial boots without markHealthy. Drop, block, report.
        this.block(s, s.pending); await this.drop(s.pending);
        s.pending = 0; s.pendingBoots = 0; s.events.push("crash_loop_revert");
      } else {
        s.pendingBoots++; this.running = s.pending; await this.save();
        return { release: s.pending, file: bundleName(s.pending) };
      }
    }
    if (s.current) {
      // Rule 11: more than 3 unhealthy boots in 60 seconds reverts to the previous release.
      s.bootTimes = [...s.bootTimes.filter((t) => now - t < WINDOW_MS), now];
      if (s.bootTimes.length > MAX_BOOTS) {
        this.block(s, s.current); await this.drop(s.current);
        s.current = s.previous; s.previous = 0; s.bootTimes = []; s.events.push("crash_loop_revert");
      }
    }
    this.running = s.current; await this.save();
    return { release: s.current, file: s.current ? bundleName(s.current) : undefined };
  }

  /** sha-256 of a stored release's archive, as checked against the signed pointer when it was staged. The native layer re-checks it before it serves the file. */
  async bundleHash(release: number): Promise<string | undefined> { return (await this.load()).hashes[String(release)]; }

  /**
   * The web view loaded a page of a release that `boot()` already chose in this process
   * (the native layer switched bundles and the new page starts the core again). Sets the running
   * release without counting another trial boot. Ignored unless it is the pending or current release.
   */
  async resume(release: number): Promise<void> {
    const s = await this.load();
    if (release && (release === s.pending || release === s.current)) this.running = release;
  }

  /** The app stayed up long enough (the native layer decides how long). Clears the boot counter. */
  async markStable() { const s = await this.load(); s.bootTimes = []; await this.save(); }

  async getState(): Promise<RuntimeState> {
    const s = await this.load();
    return { cohort: s.cohort, band: bandForCohort(s.cohort), runningRelease: this.running, currentRelease: s.current,
      pendingRelease: s.pending, previousRelease: s.previous, blockedRelease: s.blocked || undefined,
      shellVersion: s.shellVersion, baseUrl: this.c.baseUrl, appId: this.c.appId, shellMajor: this.c.shellMajor };
  }

  checkForUpdate(a: { apply: boolean }): Promise<CheckResult> { return this.locked(() => this.doCheck(a)); }
  private async doCheck({ apply }: { apply: boolean }): Promise<CheckResult> {
    const s = await this.load(); const f = this.c.fetch ?? fetch;
    const band = bandForCohort(s.cohort);
    const path = `/p/${encodeURIComponent(this.c.appId)}/${this.c.shellMajor}${this.c.platform === "ios" ? "/ios" : ""}/${band}`;
    let env: SignedEnvelope;
    try {
      const r = await f(this.c.baseUrl.replace(/\/$/, "") + path);
      if (!r.ok) return { status: "none" };
      env = SignedEnvelope.parse(await r.json());
    } catch (e) { return { status: "error", error: String((e as Error)?.message ?? e) }; }

    // Verify the signature before reading anything in the body.
    if (!(await verifyEd25519(env.body, env.signature, this.c.publicKey))) return this.reject(s, "verify_failed", "bad pointer signature");
    let p: ReleasePointerBody;
    try { p = ReleasePointerBody.parse(JSON.parse(env.body)); } catch { return this.reject(s, "pointer_rejected", "pointer is not valid"); }

    // Rules 1, 2, 3: kind, platform, app, major, band.
    if (p.kind !== "web") return this.reject(s, "pointer_rejected", "not a web bundle");
    if ((p.platform ?? "android") !== this.c.platform) return this.reject(s, "pointer_rejected", "wrong platform");
    if (p.app_id !== this.c.appId || p.shell_major !== this.c.shellMajor) return this.reject(s, "pointer_rejected", "wrong app or major");
    if (p.band !== band) return this.reject(s, "pointer_rejected", "wrong band");
    // Rule 4: newer than current, pending and blocked.
    if (p.release <= Math.max(s.current, s.pending, s.blocked)) return { status: "none", release: p.release };
    // Rule 5: minimum shell version.
    if (semverLess(this.c.shellVersion, p.min_shell_version)) return { status: "none", release: p.release };

    const t1 = this.now(); let bytes: Uint8Array;
    try {
      const url = new URL(p.core.url, this.c.baseUrl.replace(/\/?$/, "/")).toString();
      const r = await f(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      bytes = new Uint8Array(await r.arrayBuffer());
    } catch (e) { this.push(s, "download_failed"); await this.save(); return { status: "error", release: p.release, error: String((e as Error)?.message ?? e) }; }
    const t2 = this.now();
    // Size and sha-256 against the signed pointer.
    if (bytes.byteLength !== p.core.size || (await sha256Hex(bytes)) !== p.core.sha256) {
      this.block(s, p.release); return this.reject(s, "verify_failed", "bundle size or sha-256 does not match", p.release);
    }
    const t3 = this.now();
    // Stage: write the file, then point `pending` at it. A replaced pending release is dropped.
    const old = s.pending;
    await this.c.files.write(bundleName(p.release), bytes);
    s.hashes[String(p.release)] = p.core.sha256; s.pending = p.release; s.pendingBoots = 0;
    if (old && old !== p.release) await this.drop(old);
    await this.save();
    if (apply) await this.reload();
    return { status: "staged", release: p.release, bytes: bytes.byteLength, downloadMs: t2 - t1, verifyMs: t3 - t2, issuedAt: p.issued_at };
  }

  private push(s: Saved, e: string) { if (!s.events.includes(e) || !e.startsWith("pointer_rejected")) s.events.push(e); }
  private async reject(s: Saved, event: "verify_failed" | "pointer_rejected", why: string, release?: number): Promise<CheckResult> {
    this.push(s, event === "pointer_rejected" ? `pointer_rejected:${why}` : event); await this.save();
    return { status: "error", release, error: why };
  }

  /** Rule 12: promote the pending release only if it is the one running. */
  markHealthy(): Promise<HealthyResult> { return this.locked(() => this.doHealthy()); }
  private async doHealthy(): Promise<HealthyResult> {
    const s = await this.load(); const now = this.now(); let promoted = false;
    if (s.pending && s.pending === this.running) {
      await this.drop(s.previous);
      s.previous = s.current; s.current = s.pending; s.pending = 0; s.pendingBoots = 0; promoted = true;
      s.events.push("applied"); await this.save();
    }
    const kind = this.firstLoad ? "cold" : "reload"; this.firstLoad = false;
    return { release: this.running, coldStartMs: now - this.t0, sinceLoadMs: now - this.loadedAt, promoted, kind };
  }

  /** Rule 14: drop pending, block the current release, go back to the previous one. */
  rollback(): Promise<void> { return this.locked(() => this.doRollback()); }
  private async doRollback(): Promise<void> {
    const s = await this.load();
    if (s.pending) { await this.drop(s.pending); s.pending = 0; s.pendingBoots = 0; }
    if (s.current) { this.block(s, s.current); await this.drop(s.current); }
    s.current = s.previous; s.previous = 0; s.bootTimes = [];
    s.events.push("rolled_back"); await this.save();
  }

  async consumeEvents(): Promise<{ events: string[] }> {
    const s = await this.load(); const events = s.events; s.events = []; await this.save(); return { events };
  }

  async reload(): Promise<void> { this.loadedAt = this.now(); await this.c.onReload?.(); }
}
