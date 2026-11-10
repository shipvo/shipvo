import { existsSync, readFileSync } from "node:fs";
import { find, parseScreen, type Node, type Target } from "./tree.js";
import { redact } from "./secrets.js";

/** One address-book entry. */
export type Contact = { id: string; name: string; phoneNumbers?: string[]; emails?: string[] };
/** One calendar event. `start` and `end` are ISO 8601 strings. */
export type CalendarEvent = { id: string; title: string; start: string; end: string; allDay?: boolean; location?: string; notes?: string };
/** A file the simulated picker offers. `content` is its text. */
export type SeedFile = { name: string; mimeType: string; content: string };
type Grant = "granted" | "denied" | "undetermined";
/** What the simulated phone has. Takes effect for the next action. */
export type DeviceSettings = {
  location?: { latitude: number; longitude: number; accuracy?: number };
  /** What is in front of the camera: a barcode or QR code, or null for nothing. */
  camera?: { barcode?: { type: string; data: string } | null; delayMs?: number };
  permissions?: { camera?: Grant; location?: Grant; notifications?: Grant; contacts?: Grant; calendar?: Grant };
  /** The address book the app can read once contacts permission is granted. Replaces the current one. */
  contacts?: Contact[];
  /** The calendar events the app can read once calendar permission is granted. Replaces the current ones. */
  calendar?: CalendarEvent[];
  /** The files the file picker offers. Replaces the current ones. */
  files?: SeedFile[];
  biometrics?: { enrolled?: boolean; nextResult?: "success" | "fail" | "cancel" };
  payment?: { nextResult?: "approve" | "decline" | "timeout" | "insufficient_funds" | "cancel"; pin?: string };
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
  /** "agent-device" runs on a real simulator or device through the agent-device CLI. Default: SHIPVO_DEVICE_DRIVER, else "device" in shipvo.json, else Shipvo Phone. */
  driver?: "phone" | "agent-device";
  /** Platform for agent-device (default: SHIPVO_PLATFORM, else android). */
  platform?: "android" | "ios";
};
export type Notification = { id: string; title: string; body: string; data?: Record<string, unknown> };
/** An action the simulator refused. `code` is set for typed failures such as `no_url_listener` or `stale_ref`. */
export class PhoneError extends Error { constructor(message: string, readonly code?: string) { super(redact(message)); this.name = "PhoneError"; } }
/** What a mocked request answers with. An object `body` is sent as JSON. */
export type MockResponse = { /** Delivered to the session's own inbox (`phone.inbox`) when this rule answers a request, as a real server would email it. */ mail?: { from?: string; subject: string; text: string }; status: number; body?: string | Record<string, unknown> | unknown[] | null; headers?: Record<string, string>; delayMs?: number };
/** A string `url` must equal the full request URL. A RegExp is tested against it. Without `method`, any method matches. The first matching rule wins. */
export type MockRule = { url: string | RegExp; method?: string } & MockResponse;
type Reply = { ok: boolean; profile?: string; code?: string; screen?: string | null; error?: string; path?: string; notifications?: Notification[]; log?: unknown[]; capabilities?: unknown; release?: string | number; delivered?: boolean; id?: string };

/** A simulated phone running your app. Every action returns once the screen has settled, and updates `screen`. */
export class Phone {
  /** The current screen as an accessibility tree. */
  screen = "";
  readonly device: Device;
  /** The simulated address book. */
  readonly contacts: Contacts;
  /** This session's private inbox: mail the app sends (through `mockNetwork` rules with `mail`, or a POST to `https://inbox.shipvo.test/send`) lands here. No other session can read it. */
  readonly inbox: Inbox;
  readonly calendar: Calendar;
  /** The notification shade. Call it to list notifications; `receive` and `tap` deliver and open one. */
  readonly notifications: Notifications;
  /** The simulated file picker. */
  readonly files: Files;
  constructor(readonly session: string, private readonly sim: string, readonly app: string, readonly release: string | number) { this.device = new Device(this); this.contacts = new Contacts(this); this.calendar = new Calendar(this); this.files = new Files(this); this.notifications = makeNotifications(this); this.inbox = new Inbox(this); }

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
    if (!r.ok) throw new PhoneError(`${action} failed: ${r.error}\n\nScreen now:\n${this.screen}`, r.code);
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
    try { return find(this.nodes(), target); } catch (e) { throw new Error(redact(`${(e as Error).message}\n\nScreen now:\n${this.screen}`)); }
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
      if (Date.now() > end) throw new Error(redact(`timed out waiting for ${text instanceof RegExp ? text : `"${text}"`}\n\nScreen now:\n${this.screen}`));
      await new Promise((r) => setTimeout(r, opts.interval ?? 250));
    }
  }
  /** Wait until the text is gone. */
  async waitForGone(text: string | RegExp, opts: { timeout?: number; interval?: number } = {}): Promise<this> {
    const end = Date.now() + (opts.timeout ?? 5000);
    for (;;) {
      await this.refresh();
      if (!this.sees(text)) return this;
      if (Date.now() > end) throw new Error(redact(`"${text}" is still on screen after ${opts.timeout ?? 5000} ms\n\nScreen now:\n${this.screen}`));
      await new Promise((r) => setTimeout(r, opts.interval ?? 250));
    }
  }

  /** Deliver a push notification: it shows as a banner the app can be opened from. It reaches the app only if notification permission is granted (`phone.device.set({ permissions: { notifications: "granted" } })`); otherwise nothing is delivered and this still resolves. Use `phone.notifications.receive()` to learn whether it was delivered. */
  async notify(n: { title: string; body: string; data?: Record<string, unknown> }): Promise<this> { await this.act("push_notification", n); return this; }
  /** Tap a notification from the shade (the newest if no id). */
  async openNotification(id?: string): Promise<this> { await this.act("open_notification", { id }); return this; }
  /** Open a deep link in the app, as a push tap or share link would. Throws a `PhoneError` with code `no_url_listener` if the app has no `onUrl` listener. */
  async openUrl(url: string): Promise<this> { await this.act("open_url", { url }); return this; }
  /** Deliver the pending Share.share to an installed app, or to the clipboard with "copy". Throws no_share_sheet or no_such_app. */
  async shareTo(appId: string): Promise<this> { await this.act("share_to", { app_id: appId }); return this; }
  /** Stub `fetch` and XHR calls the app makes. Replaces earlier rules. Unmatched requests go to the network as usual.
   * Throws a `PhoneError` with code `mock_invalid` for a bad rule. */
  async mockNetwork(rules: MockRule[]): Promise<this> { await this.act("set_network_mocks", { rules: encodeMockRules(rules) }); return this; }
  /** Remove every network mock. */
  async clearNetworkMocks(): Promise<this> { await this.act("set_network_mocks", { rules: [] }); return this; }
  /** Make the app's network behave like a profile: "online", "offline", "2g", "3g", "slow-4g", "spotty" or "low-end-4g". The numbers are simulation settings. Throws a `PhoneError` with code `unknown_profile` for any other name. */
  async setNetwork(profile: string): Promise<this> { await this.act("set_network_profile", { profile }); return this; }
  /** The current network profile name ("online" until set). */
  async getNetwork(): Promise<string> { return (await this.act("get_network_profile")).profile as string; }
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

/** Turns rules into the wire format. The sim's parseMockRules (packages/sim/mock-rules.mjs) reads it: the two must stay in sync. */
export function encodeMockRules(rules: MockRule[]): unknown[] {
  const bad = (i: number, why: string) => new PhoneError(`mockNetwork rule ${i}: ${why}`, "mock_invalid");
  if (!Array.isArray(rules)) throw new PhoneError("mockNetwork needs an array of rules", "mock_invalid");
  return rules.map((r, i) => {
    if (!r || typeof r !== "object") throw bad(i, "must be an object");
    const { url, method, status, body, headers, delayMs, mail } = r;
    if (mail !== undefined && (!mail || typeof mail !== "object" || typeof mail.subject !== "string" || typeof mail.text !== "string" || (mail.from !== undefined && typeof mail.from !== "string"))) throw bad(i, "mail must be { subject, text } with an optional from, all strings");
    if (!(typeof url === "string" && url) && !(url instanceof RegExp)) throw bad(i, "url must be a non-empty string or a RegExp");
    if (method !== undefined && (typeof method !== "string" || !method)) throw bad(i, "method must be a non-empty string");
    if (!Number.isInteger(status) || status < 100 || status > 599) throw bad(i, "status must be an integer from 100 to 599");
    if (delayMs !== undefined && (typeof delayMs !== "number" || !(delayMs >= 0) || delayMs > 60000)) throw bad(i, "delayMs must be a number from 0 to 60000");
    const h: Record<string, string> = { ...(headers ?? {}) };
    let text = "";
    if (typeof body === "string") text = body;
    else if (body !== undefined && body !== null) {
      text = JSON.stringify(body);
      if (!Object.keys(h).some((k) => k.toLowerCase() === "content-type")) h["content-type"] = "application/json";
    }
    return { ...(typeof url === "string" ? { url } : { urlRegex: { source: url.source, flags: url.flags } }), method, response: { status, body: text, headers: h, delayMs, ...(mail ? { mail } : {}) } };
  });
}

/** One message in the session's inbox. `codes` are the 4 to 8 digit codes in it, `links` the web links. */
export type Mail = { id: string; from: string; to: string; subject: string; text: string; codes: string[]; links: string[]; received_at: string };
export type MailFilter = { subject?: string; from?: string };
/** The session's private inbox. Reads change nothing: reading twice gives the same result. */
export class Inbox {
  constructor(private readonly phone: Phone) {}
  /** The address to type into the app, for example `s-1a2b3c4d5e6f@inbox.shipvo.test`. Unique to this session. */
  async address(): Promise<string> { return ((await this.phone.act("inbox_read")) as unknown as { address: string }).address; }
  /** Every message so far, oldest first. */
  async list(filter: MailFilter = {}): Promise<Mail[]> { return ((await this.phone.act("inbox_read", { ...filter })) as unknown as { messages: Mail[] }).messages; }
  /** The first message matching `subject` and/or `from` (case-insensitive contains), already there or arriving within `timeout` ms (default 10000, at most 25000). Throws a `PhoneError` with code `inbox_timeout` when none does. */
  async waitFor(filter: MailFilter & { timeout?: number } = {}): Promise<Mail> {
    const { timeout, ...f } = filter;
    return ((await this.phone.act("inbox_wait", { ...f, ...(timeout !== undefined ? { timeout_ms: timeout } : {}) })) as unknown as { message: Mail }).message;
  }
  /** Wait for mail like `waitFor`, then return its first code (4 to 8 digits). Throws `inbox_no_code` if the mail has none. */
  async code(filter: MailFilter & { timeout?: number } = {}): Promise<string> {
    const m = await this.waitFor(filter);
    if (!m.codes.length) throw new PhoneError(`the mail "${m.subject}" has no 4 to 8 digit code`, "inbox_no_code");
    return m.codes[0];
  }
  /** Empty the inbox. */
  async clear(): Promise<void> { await this.phone.act("inbox_clear"); }
}

/** The simulated address book. Apps read it with `expo-contacts` or `device.contacts.getAll()`; writing back is not simulated. */
export class Contacts {
  constructor(private readonly phone: Phone) {}
  /** Seed the address book (replaces what was there). The app still asks for permission; answer with `phone.device.set({ permissions: { contacts } })` or tap the dialog. */
  async set(contacts: Contact[]): Promise<Phone> { await this.phone.act("set_device", { device: { contacts } }); return this.phone; }
}

/** `phone.notifications()` lists the shade (banners vanish after about 5 s, the shade keeps them). */
export interface Notifications {
  (): Promise<Notification[]>;
  /** Push a notification to the app. It reaches the app only if notification permission is granted; resolves `false` (and the app sees nothing) when it is not. */
  receive(n: { title: string; body: string; data?: Record<string, unknown> }): Promise<boolean>;
  /** Tap a notification in the shade (the newest if no id): the app's tap handler runs with its `data`. */
  tap(id?: string): Promise<Phone>;
}
function makeNotifications(phone: Phone): Notifications {
  const list = async () => ((await phone.act("notifications")).notifications ?? []);
  return Object.assign(list, {
    async receive(n: { title: string; body: string; data?: Record<string, unknown> }) { return (await phone.act("push_notification", n)).delivered === true; },
    async tap(id?: string) { await phone.act("open_notification", { id }); return phone; },
  });
}

/** The simulated file picker. The app opens it with `expo-document-picker` or `device.files.pick()`; you answer it here. */
export class Files {
  constructor(private readonly phone: Phone) {}
  /** Seed the files the picker offers (replaces what was there). */
  async set(files: SeedFile[]): Promise<Phone> { await this.phone.act("set_device", { device: { files } }); return this.phone; }
  /** Pick a file in the open picker dialog by name. */
  async pick(name: string): Promise<Phone> { return this.phone.tap({ role: "button", name }); }
  /** Cancel the open picker dialog. */
  async cancel(): Promise<Phone> { return this.phone.tap({ role: "button", name: "Cancel" }); }
}

/** The simulated calendar. Apps read it with `expo-calendar` or `device.calendar.getEvents()`; writing back is not simulated. */
export class Calendar {
  constructor(private readonly phone: Phone) {}
  /** Seed the calendar (replaces what was there). The app still asks for permission; answer with `phone.device.set({ permissions: { calendar } })` or tap the dialog. */
  async set(events: CalendarEvent[]): Promise<Phone> { await this.phone.act("set_device", { device: { calendar: events } }); return this.phone; }
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

function configDriver(): string | undefined {
  if (!existsSync("shipvo.json")) return undefined;
  try { return JSON.parse(readFileSync("shipvo.json", "utf8")).device; } catch { return undefined; }
}

/** Open your app in a fresh simulated phone. */
export async function openApp(opts: OpenOptions = {}): Promise<Phone> {
  const driver = opts.driver ?? process.env.SHIPVO_DEVICE_DRIVER ?? configDriver();
  if (driver === "agent-device") {
    const { openAgentDevice } = await import("./agent-device.js");
    return openAgentDevice(opts.app ?? defaultApp(), { platform: opts.platform });
  }
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
