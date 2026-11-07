import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Phone, PhoneError } from "./phone.js";

export const NOT_INSTALLED = "agent-device is not installed; npm i -D agent-device, or drop --device to use Shipvo Phone";

/** One element from the agent-device accessibility snapshot. `rect` is in screen points. */
export type AdNode = { ref: string; kind: string; label: string; rect?: { x: number; y: number; width: number; height: number } };
export type AgentDeviceOptions = { bin?: string; platform?: "android" | "ios"; timeoutMs?: number };

/** agent-device kinds that are Shipvo roles under another name. Others pass through unchanged. */
const ROLES: Record<string, string> = {
  "text-field": "textbox", "edit-text": "textbox", input: "textbox", textfield: "textbox", "secure-text-field": "textbox",
  "search-field": "searchbox", searchfield: "searchbox", "static-text": "text", label: "text", "text-view": "text", "image-view": "img",
  image: "img", "navigation-bar": "navigation", other: "generic", group: "generic",
};
const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Parse `agent-device snapshot` output: the `--json` form (an array, or an object holding `nodes`), or the text form (`@e4 [button] "Lists"`). */
export function parseSnapshot(raw: string): AdNode[] {
  const text = raw.trim();
  if (text.startsWith("{") || text.startsWith("[")) {
    let j: unknown;
    try { j = JSON.parse(text); } catch { throw new PhoneError("agent-device returned a snapshot that is not valid JSON", "agent_device_output"); }
    const find = (v: unknown): unknown[] | undefined => {
      if (Array.isArray(v)) return v;
      if (v && typeof v === "object") { const o = v as Record<string, unknown>; return find(o.nodes) ?? find(o.data) ?? find(o.snapshot); }
      return undefined;
    };
    const list = find(j);
    if (!list) throw new PhoneError("agent-device snapshot has no nodes", "agent_device_output");
    const out: AdNode[] = [];
    for (const n of list as Record<string, unknown>[]) {
      if (!n || typeof n.ref !== "string") continue;
      const r = n.rect as Record<string, unknown> | undefined;
      const rect = r && [r.x, r.y, r.width, r.height].every((v) => typeof v === "number") ? { x: r.x as number, y: r.y as number, width: r.width as number, height: r.height as number } : undefined;
      out.push({ ref: n.ref.replace(/^@/, ""), kind: String(n.kind ?? n.role ?? "other"), label: String(n.label ?? n.name ?? ""), rect });
    }
    return out;
  }
  const out: AdNode[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*@(\w+) \[([^\]]+)\](?: "((?:[^"\\]|\\.)*)")?/.exec(line);
    if (m) out.push({ ref: m[1]!, kind: m[2]!, label: (m[3] ?? "").replace(/\\(.)/g, "$1") });
  }
  return out;
}

/** Map a snapshot to the screen tree Shipvo Phone returns: `- role "name" [ref=e4] [bounds=x,y,w,h]`. Bounds are the element's position and size. */
export function toScreen(nodes: AdNode[]): string {
  return nodes.map((n) => {
    const k = n.kind.toLowerCase();
    const role = ROLES[k] ?? k.replace(/[^\w-]/g, "") ?? "generic";
    const b = n.rect ? ` [bounds=${[n.rect.x, n.rect.y, n.rect.width, n.rect.height].map((v) => Math.round(v)).join(",")}]` : "";
    const head = role === "text" || role === "generic" || role === "img" ? `- ${role} [ref=${n.ref}]${b}${n.label ? `: ${n.label.replace(/\n/g, " ")}` : ""}` : `- ${role}${n.label ? " " + quote(n.label.replace(/\n/g, " ")) : ""} [ref=${n.ref}]${b}`;
    return head;
  }).join("\n");
}

/** Size in points of each ref that has bounds. */
export function sizesOf(nodes: AdNode[]): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const n of nodes) if (n.rect) out[n.ref] = [Math.round(n.rect.width), Math.round(n.rect.height)];
  return out;
}

/** Calls the `agent-device` CLI. The binary is `bin`, else SHIPVO_AGENT_DEVICE_BIN, else ./node_modules/.bin/agent-device, else `agent-device` on PATH. */
export class AgentDevice {
  private readonly bin: string;
  constructor(private readonly o: AgentDeviceOptions = {}) {
    const local = join(process.cwd(), "node_modules", ".bin", "agent-device");
    this.bin = o.bin ?? process.env.SHIPVO_AGENT_DEVICE_BIN ?? (existsSync(local) ? local : "agent-device");
  }
  get platform(): "android" | "ios" { return this.o.platform ?? (process.env.SHIPVO_PLATFORM === "ios" ? "ios" : "android"); }
  run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(this.bin, [...args, "--platform", this.platform], { timeout: this.o.timeoutMs ?? 60000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return reject(new PhoneError(NOT_INSTALLED, "agent_device_missing"));
        reject(new PhoneError(`agent-device ${args[0]} failed: ${(stderr || stdout || err.message).trim().split("\n").slice(0, 5).join("\n")}`, "agent_device_failed"));
      });
    });
  }
  async snapshot(): Promise<AdNode[]> { return parseSnapshot(await this.run(["snapshot", "--json"])); }
  async open(target: string): Promise<void> { await this.run(["open", target]); }
  async tap(ref: string): Promise<void> { await this.run(["click", "@" + ref.replace(/^@/, "")]); }
  async fill(ref: string, text: string): Promise<void> { await this.run(["fill", "@" + ref.replace(/^@/, ""), text]); }
  async scroll(direction: string): Promise<void> { await this.run(["scroll", direction]); }
  async back(): Promise<void> { await this.run(["back"]); }
  async screenshot(): Promise<Uint8Array> {
    const dir = mkdtempSync(join(tmpdir(), "shipvo-ad-"));
    try { const p = join(dir, "screen.png"); await this.run(["screenshot", p]); return new Uint8Array(readFileSync(p)); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  }
}

/** A phone backed by a real simulator or device through agent-device. Same typed API as Shipvo Phone; simulated-hardware calls (`device.set`, mocks) throw `unsupported`. */
export class AgentDevicePhone extends Phone {
  nodesRaw: AdNode[] = [];
  constructor(readonly ad: AgentDevice, app: string) { super("agent-device", "", app, "local"); }
  async read(): Promise<void> { this.nodesRaw = await this.ad.snapshot(); this.screen = toScreen(this.nodesRaw); }
  /** @internal */
  override async call(path: string): Promise<never> { throw new PhoneError(`${path} is not available on a real device through agent-device`, "unsupported"); }
  /** @internal */
  override async act(action: string, extra: Record<string, unknown> = {}): Promise<{ ok: boolean }> {
    const ref = extra.ref as string | undefined;
    switch (action) {
      case "tap": await this.ad.tap(ref!); break;
      case "type":
        if (extra.enter) throw new PhoneError("type with enter is not available through agent-device; tap the keyboard's action button", "unsupported");
        await this.ad.fill(ref!, String(extra.text ?? "")); break;
      case "scroll": await this.ad.scroll(String(extra.direction ?? "down")); break;
      case "back": await this.ad.back(); break;
      case "open_url": await this.ad.open(String(extra.url)); break;
      case "screen": break;
      default: throw new PhoneError(`${action} is not available on a real device through agent-device`, "unsupported");
    }
    await this.read();
    return { ok: true };
  }
  override async screenshot(): Promise<Uint8Array> { return this.ad.screenshot(); }
}

/** Open the app on the simulator or device agent-device drives. */
export async function openAgentDevice(app: string, o: AgentDeviceOptions = {}): Promise<AgentDevicePhone> {
  const ad = new AgentDevice(o);
  const phone = new AgentDevicePhone(ad, app.split("@")[0]!);
  await ad.open(phone.app);
  await phone.read();
  return phone;
}

/** The explorer's driver shape (`open`, `tap`, `type`, `snapshot`, `sizes`…) over agent-device. Used by `shipvo lumi --device agent-device`. */
export function agentDeviceDriver(app: string, o: AgentDeviceOptions = {}) {
  const ad = new AgentDevice(o);
  let nodes: AdNode[] = [];
  type R = { ok: boolean; screen?: string | null; error?: string; code?: string };
  const look = async (): Promise<R> => { nodes = await ad.snapshot(); return { ok: true, screen: toScreen(nodes) }; };
  const step = (f: () => Promise<void>) => async (): Promise<R> => {
    try { await f(); return await look(); } catch (e) { return { ok: false, error: (e as Error).message, code: (e as PhoneError).code }; }
  };
  return {
    open: step(() => ad.open(app)),
    openUrl: (url: string) => step(() => ad.open(url))(),
    tap: (ref: string) => step(() => ad.tap(ref))(),
    back: step(() => ad.back()),
    type: (ref: string, text: string, enter?: boolean) => enter ? Promise.resolve<R>({ ok: false, error: "type with enter is not available through agent-device; tap the keyboard's action button", code: "unsupported" }) : step(() => ad.fill(ref, text))(),
    snapshot: look,
    errors: async () => [] as string[],
    sizes: async () => sizesOf(nodes),
    screenshot: () => ad.screenshot(),
  };
}
