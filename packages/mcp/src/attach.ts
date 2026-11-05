// Attach to a live `shipvo run` phone. `open_app` reads `.shipvo/run.json`, and if the run is alive and is the
// same app, drives it over the agent channel as the `driver`. The types below mirror
// packages/cli/src/run-protocol.ts: MCP cannot import from the CLI (rootDir is src, and the CLI is not a dependency).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type RunInfo = { port: number; platform: "android" | "ios"; app: string; token: string; pid: number };
export type DriverMessage = { id: number; type: string; [key: string]: unknown };
export type ScreenMessage = { id?: number; type?: string; ok?: boolean; error?: string; code?: string; screen?: string | null; [key: string]: unknown };

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };

// Safety: run.json may come from a parent directory, but we only ever connect to 127.0.0.1 and send its token there.
/** Finds `.shipvo/run.json` in `cwd` or a parent, stopping after the git root. Returns it only if the pid is alive and the app matches. */
export function findLiveRun(app: string, cwd = process.cwd()): RunInfo | undefined {
  let dir = resolve(cwd);
  for (;;) {
    const file = join(dir, ".shipvo", "run.json");
    if (existsSync(file)) {
      try {
        const i = JSON.parse(readFileSync(file, "utf8")) as Partial<RunInfo>;
        if (typeof i.port === "number" && typeof i.token === "string" && typeof i.pid === "number" && typeof i.app === "string" && i.app === app && alive(i.pid)) return i as RunInfo;
      } catch {}
      return undefined; // the nearest run.json decides
    }
    if (existsSync(join(dir, ".git")) || dirname(dir) === dir) return undefined;
    dir = dirname(dir);
  }
}

export type Driver = { request(type: string, args?: Record<string, unknown>, ms?: number): Promise<ScreenMessage>; close(): void; closed: boolean };

/** Connects as `driver`. Rejects if the socket cannot open within `ms`. */
export function connectDriver(info: RunInfo, ms = 3000): Promise<Driver> {
  return new Promise((ok, fail) => {
    if (typeof WebSocket === "undefined") return fail(new Error("attach needs Node 22+ (no global WebSocket in this Node version)"));
    const ws = new WebSocket(`ws://127.0.0.1:${info.port}/__shipvo/agent?role=driver&token=${encodeURIComponent(info.token)}`);
    const pending = new Map<number, (m: ScreenMessage) => void>();
    let next = 1, opened = false;
    const d: Driver = {
      closed: false,
      close: () => { try { ws.close(); } catch {} },
      request: (type, args = {}, limit = 10000) => new Promise((res) => {
        if (d.closed) return res({ ok: false, code: "attach_closed", error: "the shipvo run phone is gone: call open_app again" });
        const id = next++;
        const t = setTimeout(() => { pending.delete(id); res({ ok: false, code: "sim_timeout", error: `the live phone did not answer "${type}" within ${limit} ms. The action may still have run: call screen to see where it is.` }); }, limit);
        pending.set(id, (m) => { clearTimeout(t); res(m); });
        ws.send(JSON.stringify({ ...args, id, type } satisfies DriverMessage));
      }),
    };
    const timer = setTimeout(() => { ws.close(); fail(new Error("timed out connecting to the shipvo run phone")); }, ms);
    ws.onopen = () => { opened = true; clearTimeout(timer); ok(d); };
    ws.onmessage = (e) => {
      try { const m = JSON.parse(String(e.data)) as ScreenMessage; if (m.id !== undefined) { pending.get(m.id)?.(m); pending.delete(m.id); } } catch {}
    };
    ws.onclose = () => {
      d.closed = true;
      for (const [id, f] of pending) { f({ ok: false, code: "attach_closed", error: "the shipvo run phone closed the connection: call open_app again" }); pending.delete(id); }
      if (!opened) { clearTimeout(timer); fail(new Error("could not connect to the shipvo run phone")); }
    };
    ws.onerror = () => {};
  });
}
