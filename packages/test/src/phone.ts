import { existsSync, readFileSync } from "node:fs";
import { find, parseScreen, type Node, type Target } from "./tree.js";

type Grant = "granted" | "denied" | "undetermined";
/** What the simulated phone has. Takes effect for the next action. */
export type DeviceSettings = {
  location?: { latitude: number; longitude: number; accuracy?: number };
  /** What is in front of the camera: a barcode or QR code, or null for nothing. */
  camera?: { barcode?: { type: string; data: string } | null; delayMs?: number };
  permissions?: { camera?: Grant; location?: Grant; notifications?: Grant };
  biometrics?: { enrolled?: boolean; nextResult?: "success" | "fail" | "cancel" };
  payment?: { nextResult?: "approve" | "decline" | "timeout" | "insufficient_funds"; pin?: string };
  online?: boolean;
};
export type DeviceProfile = { platform?: "android" | "ios"; api?: number };
export type OpenOptions = {
  /** App id (default: SHIPVO_APP, else appId from ./shipvo.json). "id@latest" or "id@r13" opens a published release. */
  app?: string;
  /** Simulator URL (default: PN_SIM, else http://localhost:4545). */
  sim?: string;
  dark?: boolean;
  session?: string;
  /** Test shortcut passed to the app as globalThis.__PN_SIM__.seed_cart, in whatever shape your app reads (Tide reads { product_id, quantity }). */
  seedCart?: Record<string, unknown>[];
  /** Applied right after opening, before the first screen is read. */
  device?: DeviceSettings;
};
export type Notification = { id: string; title: string; body: string; data?: Record<string, unknown> };
type Reply = { ok: boolean; screen?: string | null; error?: string; path?: string; notifications?: Notification[]; log?: unknown[]; capabilities?: unknown; release?: string | number };

/** A simulated phone running your app. Every action returns once the screen has settled, and updates `screen`. */
export class Phone {
  /** The current screen as an accessibility tree. */
  screen = "";
  readonly device: Device;
  constructor(readonly session: string, private readonly sim: string, readonly app: string, readonly release: string | number) { this.device = new Device(this); }

  /** @internal */
  async call(path: string, body: Record<string, unknown>): Promise<Reply> {
    const r = await fetch(this.sim + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`simulator ${path} answered ${r.status}. Is it running at ${this.sim}? Start it with: npx shipvo sim`);
    return (await r.json()) as Reply;
  }
  /** @internal */
  async act(action: string, extra: Record<string, unknown> = {}): Promise<Reply> {
    const r = await this.call("/act", { session: this.session, action, ...extra });
    if (typeof r.screen === "string") this.screen = r.screen;
    // A page that is still loading reads as empty: give it a moment rather than report a blank screen.
    for (let i = 0; r.ok && action !== "screenshot" && !this.screen.trim() && i < 10; i++) {
      await new Promise((res) => setTimeout(res, 200));
      const again = await this.call("/act", { session: this.session, action: "screen" });
      if (typeof again.screen === "string") this.screen = again.screen;
    }
    if (!r.ok) throw new Error(`${action} failed: ${r.error}\n\nScreen now:\n${this.screen}`);
    return r;
  }

  /** Every element on the current screen. */
  nodes(): Node[] { return parseScreen(this.screen); }
  /** Is this text (or pattern) anywhere on the current screen? */
  sees(text: string | RegExp): boolean {
    return text instanceof RegExp ? text.test(this.screen) : this.screen.toLowerCase().includes(text.toLowerCase());
  }
  /** Find one element without acting on it. Throws if none or several match. */
  locate(target: Target): Node {
    try { return find(this.nodes(), target); } catch (e) { throw new Error(`${(e as Error).message}\n\nScreen now:\n${this.screen}`); }
  }

  async tap(target: Target): Promise<this> { await this.act("tap", { ref: this.locate(target).ref }); return this; }
  async type(target: Target, text: string, opts: { enter?: boolean } = {}): Promise<this> {
    const n = find(this.nodes(), target, typeof target === "string" || target instanceof RegExp ? { roles: ["textbox", "searchbox", "spinbutton", "combobox"] } : {});
    await this.act("type", { ref: n.ref, text, enter: opts.enter }); return this;
  }
  async scroll(direction: "down" | "up" | "left" | "right" = "down", on?: Target): Promise<this> {
    await this.act("scroll", { direction, ref: on ? this.locate(on).ref : undefined }); return this;
  }
  async back(): Promise<this> { await this.act("back"); return this; }
  async refresh(): Promise<this> { await this.act("screen"); return this; }

  /** Wait until the text appears (default 5 s). On timeout the error carries the last screen. */
  async waitFor(text: string | RegExp, opts: { timeout?: number; interval?: number } = {}): Promise<this> {
    const end = Date.now() + (opts.timeout ?? 5000);
    for (;;) {
      await this.refresh();
      if (this.sees(text)) return this;
      if (Date.now() > end) throw new Error(`timed out waiting for ${text instanceof RegExp ? text : `"${text}"`}\n\nScreen now:\n${this.screen}`);
      await new Promise((r) => setTimeout(r, opts.interval ?? 250));
    }
  }
  /** Wait until the text is gone. */
  async waitForGone(text: string | RegExp, opts: { timeout?: number; interval?: number } = {}): Promise<this> {
    const end = Date.now() + (opts.timeout ?? 5000);
    for (;;) {
      await this.refresh();
      if (!this.sees(text)) return this;
      if (Date.now() > end) throw new Error(`"${text}" is still on screen after ${opts.timeout ?? 5000} ms\n\nScreen now:\n${this.screen}`);
      await new Promise((r) => setTimeout(r, opts.interval ?? 250));
    }
  }

  /** Deliver a push notification: it shows as a banner the app can be opened from. */
  async notify(n: { title: string; body: string; data?: Record<string, unknown> }): Promise<this> { await this.act("push_notification", n); return this; }
  /** The notification shade (banners vanish after about 5 s, the shade keeps them). */
  async notifications(): Promise<Notification[]> { return (await this.act("notifications")).notifications ?? []; }
  /** Tap a notification from the shade (the newest if no id). */
  async openNotification(id?: string): Promise<this> { await this.act("open_notification", { id }); return this; }
  /** What the app did with the device: permission prompts and answers, location reads, scans, fingerprint checks, payments. */
  async deviceLog(): Promise<unknown[]> { return (await this.act("device_log")).log ?? []; }
  /** A PNG of the screen. Works when the test runs on the same machine as the simulator, as in CI. */
  async screenshot(): Promise<Uint8Array> {
    const r = await this.act("screenshot");
    if (!r.path) throw new Error("the simulator returned no screenshot");
    return new Uint8Array(readFileSync(r.path));
  }
  /** Nothing to release on the simulator side today; kept so tests read the same if that changes. */
  async close(): Promise<void> {}
}

/** The simulated phone's hardware and settings. */
export class Device {
  constructor(private readonly phone: Phone) {}
  async set(settings: DeviceSettings): Promise<Phone> { await this.phone.act("set_device", { device: settings }); return this.phone; }
  /** Back to a known state: permissions undetermined, default location, nothing in front of the camera, log cleared. */
  async reset(profile: DeviceProfile = {}): Promise<Phone> { await this.phone.act("device_reset", { device: profile }); return this.phone; }
}

function defaultApp(): string {
  if (process.env.SHIPVO_APP) return process.env.SHIPVO_APP;
  if (existsSync("shipvo.json")) { try { return JSON.parse(readFileSync("shipvo.json", "utf8")).appId; } catch { /* fall through */ } }
  throw new Error("which app? Pass { app } to openApp, set SHIPVO_APP, or run from a folder with shipvo.json");
}

/** Open your app in a fresh simulated phone. */
export async function openApp(opts: OpenOptions = {}): Promise<Phone> {
  const sim = (opts.sim ?? process.env.PN_SIM ?? "http://localhost:4545").replace(/\/$/, "");
  const app = opts.app ?? defaultApp();
  const session = opts.session ?? `t-${Math.random().toString(36).slice(2, 10)}`;
  const probe = new Phone(session, sim, app.split("@")[0]!, "local");
  const r = await probe.call("/session", { session, app, seed_cart: opts.seedCart, dark: opts.dark });
  if (!r.ok) throw new Error(`could not open "${app}": ${r.error}`);
  const phone = new Phone(session, sim, app.split("@")[0]!, r.release ?? "local");
  phone.screen = r.screen ?? "";
  if (!phone.screen.trim()) await phone.refresh(); // a seeded cart reloads the page: read the screen again
  if (opts.device) await phone.device.set(opts.device);
  return phone;
}
