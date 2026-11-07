import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../src/init";
import { store } from "../src/store";

let tmp = "", app = "";
const cwd = process.cwd();
beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "store-"));
  app = join(tmp, "my-shop");
  vi.spyOn(console, "log").mockImplementation(() => {});
  await init([app, "--name", "My Shop", "--public-key", "AAAA"]);
  process.chdir(app);
});
afterAll(() => { process.chdir(cwd); rmSync(tmp, { recursive: true, force: true }); });

it("store details --dry-run on a scaffolded app writes the two files", async () => {
  const log = vi.spyOn(console, "log");
  log.mockClear();
  await store(["details", "--dry-run", "--out", "out"]);
  expect(readFileSync(join(app, "out/data-safety.csv"), "utf8")).toContain("PSL_PRECISE_LOCATION");
  expect(readFileSync(join(app, "out/privacy-policy.md"), "utf8")).toContain("Review before publishing");
  const printed = log.mock.calls.map((c) => c.join(" ")).join("\n");
  expect(printed).toContain("You still need to answer");
  expect(printed).toContain("Nothing was uploaded");
});

it("without --dry-run it exits 2 and writes nothing", async () => {
  const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(store(["details", "--out", "nope"])).rejects.toThrow("exit");
  expect(exit).toHaveBeenCalledWith(2);
  expect(err.mock.calls.join("\n")).toContain("upload is not available yet; use --dry-run");
  expect(existsSync(join(app, "nope"))).toBe(false);
  exit.mockRestore(); err.mockRestore();
});

it("--out with no value falls back to .shipvo/store", async () => {
  await store(["details", "--dry-run", "--out"]);
  expect(existsSync(join(app, ".shipvo/store/data-safety.csv"))).toBe(true);
});

import { mkdtempSync as mk, existsSync as ex } from "node:fs";

async function inTemp<T>(fn: () => Promise<T>): Promise<T> {
  const d = mk(join(tmpdir(), "plan-"));
  const prev = process.cwd();
  process.chdir(d);
  try { return await fn(); } finally { process.chdir(prev); rmSync(d, { recursive: true, force: true }); }
}
const out = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c) => c.join(" ")).join("\n");

it("store setup with flags needs no prompt and names the tester rule for a personal account", async () => {
  await inTemp(async () => {
    const log = vi.spyOn(console, "log"); log.mockClear();
    await store(["setup", "--company", "no"]);
    expect(ex("store-plan.json")).toBe(true);
    expect(out(log)).toContain("12 testers");
    expect(out(log)).toContain("14 days in a row");
  });
});

it("store setup for a company does not mention the tester rule", async () => {
  await inTemp(async () => {
    const log = vi.spyOn(console, "log"); log.mockClear();
    await store(["setup", "--company", "yes"]);
    expect(out(log)).not.toContain("12 testers");
    log.mockClear();
    await store(["status"]);
    expect(out(log)).not.toContain("12 testers");
  });
});

it("store setup with a bad flag value exits 2", async () => {
  await inTemp(async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
    await expect(store(["setup", "--company", "maybe"])).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(2);
    expect(out(err)).toContain("must be yes or no");
    expect(ex("store-plan.json")).toBe(false);
    exit.mockRestore();
  });
});

it("store status with no plan says to run setup", async () => {
  await inTemp(async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {}); err.mockClear();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
    await expect(store(["status"])).rejects.toThrow("exit");
    expect(out(err)).toContain("shipvo store setup");
    exit.mockRestore();
  });
});

it("store status prints a next action per store and --mark moves it on", async () => {
  await inTemp(async () => {
    const log = vi.spyOn(console, "log");
    await store(["setup", "--company", "no"]);
    log.mockClear();
    await store(["status"]);
    let o = out(log);
    expect(o.match(/Next:/g)?.length).toBe(2);
    expect(o).toContain("[todo] play-account");
    log.mockClear();
    await store(["status", "--mark", "play-account"]);
    await store(["status", "--mark", "apple-account", "--as", "waiting"]);
    log.mockClear();
    await store(["status"]);
    o = out(log);
    expect(o).toContain("[done] play-account");
    expect(o).toContain("[waiting] apple-account");
    expect(o).toContain("Next: wait.");
    expect(o).toContain("shipvo store status --mark play-closed-test");
  });
});

const jpeg = (w: number, h: number) => Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);

it("store screenshots (fast mode) writes a passing file per route in every set", async () => {
  const { renderScreenshots, RENDER_SETS } = await import("../src/store");
  const log = vi.spyOn(console, "log"); log.mockClear();
  const seen: (string | undefined)[] = [];
  const code = await renderScreenshots(["tide://cart", "tide://tides"], async (s, route) => { seen.push(route); return jpeg(s.width, s.height); }, "raw");
  expect(code).toBe(0);
  for (const { set } of RENDER_SETS) {
    expect(existsSync(join(app, "raw", set, "01-start.jpg"))).toBe(true);
    expect(existsSync(join(app, "raw", set, "02-cart.jpg"))).toBe(true);
    expect(existsSync(join(app, "raw", set, "03-tides.jpg"))).toBe(true);
  }
  expect(seen).toHaveLength(RENDER_SETS.length * 3);
  const printed = log.mock.calls.map((c) => c.join(" ")).join("\n");
  expect(printed).toContain("fast mode: simulator render, not the native UI");
  expect(printed).toContain("raw/iphone/01-start.jpg: ok");
});

it("store screenshots reports a wrong size and exits non-zero", async () => {
  const { renderScreenshots } = await import("../src/store");
  const log = vi.spyOn(console, "log"); log.mockClear();
  const code = await renderScreenshots(undefined, async () => jpeg(100, 100), "raw-bad");
  expect(code).toBe(1);
  expect(log.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("FAILED");
});

it("store screenshots names a non-image file .bin, not by its first byte", async () => {
  const { renderScreenshots } = await import("../src/store");
  const code = await renderScreenshots(undefined, async () => Uint8Array.from([1, 2, 3]), "raw-junk");
  expect(code).toBe(1);
  expect(existsSync(join(app, "raw-junk/iphone/01-start.bin"))).toBe(true);
});

it("store testers prints the steps and makes no Play call without --play-key", async () => {
  const f = vi.spyOn(globalThis, "fetch");
  const log = vi.spyOn(console, "log"); log.mockClear();
  await store(["testers", "--package", "com.example.shop"]);
  const printed = log.mock.calls.map((c) => c.join(" ")).join("\n");
  expect(printed).toContain("https://play.google.com/apps/testing/com.example.shop");
  expect(printed).toContain("shipvo-testers@googlegroups.com");
  expect(printed).toContain("14 days");
  expect(printed).toContain("first upload of a new app to be made by hand");
  expect(f).not.toHaveBeenCalled();
  f.mockRestore();
});

it("store testers --json is parseable", async () => {
  const log = vi.spyOn(console, "log"); log.mockClear();
  await store(["testers", "--package", "com.example.shop", "--json"]);
  const doc = JSON.parse(log.mock.calls.map((c) => c.join(" ")).join("\n"));
  expect(doc.ok).toBe(true); expect(doc.code).toBe("testers_guide");
  const j = doc.data;
  expect(j.optInUrl).toBe("https://play.google.com/apps/testing/com.example.shop");
  expect(j.group).toBe("shipvo-testers@googlegroups.com");
  expect(j.api).toBeUndefined();
});

it("addTesterGroup keeps existing groups and commits one edit", async () => {
  const { addTesterGroup } = await import("../src/store");
  const calls: { url: string; method: string; body?: string }[] = [];
  const fake = (async (url: string, init: any) => {
    calls.push({ url, method: init.method, body: init.body });
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (url.endsWith("/edits")) return json({ id: "E1" });
    if (init.method === "GET") return json({ googleGroups: ["mine@googlegroups.com"] });
    return json({});
  }) as unknown as typeof fetch;
  const r = await addTesterGroup({ pkg: "com.example.shop", token: "t", group: "shipvo-testers@googlegroups.com", fetch: fake });
  expect(r.groups).toEqual(["mine@googlegroups.com", "shipvo-testers@googlegroups.com"]);
  const put = calls.find((c) => c.method === "PUT")!;
  expect(put.url).toContain("/applications/com.example.shop/edits/E1/testers/alpha");
  expect(JSON.parse(put.body!)).toEqual({ googleGroups: r.groups });
  expect(calls.at(-1)!.url).toContain("/edits/E1:commit");
});

it("addTesterGroup does not write when the group is already there", async () => {
  const { addTesterGroup } = await import("../src/store");
  const methods: string[] = [];
  const fake = (async (url: string, init: any) => {
    methods.push(init.method);
    return new Response(JSON.stringify(url.endsWith("/edits") ? { id: "E" } : { googleGroups: ["shipvo-testers@googlegroups.com"] }), { status: 200 });
  }) as unknown as typeof fetch;
  const r = await addTesterGroup({ pkg: "p", token: "t", group: "shipvo-testers@googlegroups.com", fetch: fake });
  expect(r.added).toBe(false);
  expect(methods).not.toContain("PUT");
});

describe("store screenshots --mode frames", () => {
  const pngOf = async (w: number, h: number) => {
    const { encodePng } = await import("@shipvo/store");
    return encodePng({ width: w, height: h, rgb: new Uint8Array(w * h * 3).fill(180) });
  };

  it("writes a framed PNG per route in every set, passes the checker, and uses captions then titles", async () => {
    const { renderScreenshots, captionFor } = await import("../src/store");
    const log = vi.spyOn(console, "log"); log.mockClear();
    const formats: (string | undefined)[] = [];
    const caption = captionFor({ name: "Tide", store: { captions: { "tide://cart": "Pay in one tap" } } });
    expect(caption("tide://cart", "cart")).toBe("Pay in one tap");
    expect(caption("tide://tides", "tides")).toBe("Tides");
    expect(caption(undefined, "start")).toBe("Tide");
    const code = await renderScreenshots(["tide://cart"], async (s, _r, f) => { formats.push(f); return pngOf(s.width, s.height); }, "frames-out", { caption });
    expect(code).toBe(0);
    expect(new Set(formats)).toEqual(new Set(["png"]));
    for (const set of ["iphone", "ipad-13", "play-phone", "play-tablet-7", "play-tablet-10"]) {
      expect(existsSync(join(app, "frames-out", set, "01-start.png"))).toBe(true);
      expect(existsSync(join(app, "frames-out", set, "02-cart.png"))).toBe(true);
    }
    expect(log.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("frames mode");
  }, 60000);

  it("--json prints one envelope and nothing else", async () => {
    const { renderScreenshots } = await import("../src/store");
    const log = vi.spyOn(console, "log"); log.mockClear();
    const code = await renderScreenshots(undefined, async (s) => pngOf(s.width, s.height), "frames-json", { caption: () => "Hello", json: true });
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    const env = JSON.parse(String(log.mock.calls[0][0]));
    expect(env.ok).toBe(true);
    expect(env.mode).toBe("frames");
    expect(env.files).toHaveLength(5);
  }, 60000);

  it("reports a JPEG render as a failed file, not a crash", async () => {
    const { renderScreenshots } = await import("../src/store");
    const code = await renderScreenshots(undefined, async () => jpeg(100, 100), "frames-bad", { caption: () => "x", json: true });
    expect(code).toBe(1);
  });

  it("--json with --mode frames puts the frames report in the stdout envelope", async () => {
    const { createServer } = await import("node:http");
    const { encodePng } = await import("@shipvo/store");
    const srv = createServer((req, res) => {
      let body = ""; req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const b = JSON.parse(body || "{}");
        if (req.url === "/session" && b.width) (srv as any).size = { w: b.width, h: b.height };
        const sz = (srv as any).size ?? { w: 100, h: 100 };
        const data = req.url === "/act" && b.action === "screenshot" ? Buffer.from(encodePng({ width: sz.w, height: sz.h, rgb: new Uint8Array(sz.w * sz.h * 3).fill(180) })).toString("base64") : undefined;
        // No keep-alive: on a busy runner the socket can idle past the server timeout, and the next request on it fails with "fetch failed".
        res.setHeader("connection", "close"); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, data }));
      });
    });
    await new Promise<void>((r) => srv.listen(0, r));
    const port = (srv.address() as { port: number }).port;
    const out: string[] = [];
    const w = vi.spyOn(process.stdout, "write").mockImplementation(((c: string) => { out.push(String(c)); return true; }) as never);
    const log = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { out.push(a.join(" ") + "\n"); });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try { await store(["screenshots", "--mode", "frames", "--out", "json-frames", "--sim", `http://127.0.0.1:${port}`, "--json"]); }
    finally { w.mockRestore(); log.mockRestore(); err.mockRestore(); srv.close(); }
    const doc = JSON.parse(out.join(""));
    expect(doc.code, doc.summary).toBe("screenshots_ready");
    expect(doc.data.mode).toBe("frames");
    expect(doc.data.out).toBe("json-frames");
    expect(doc.data.files).toHaveLength(5);
    expect(doc.data.files.every((f: { ok: boolean }) => f.ok)).toBe(true);
    process.exitCode = undefined;
  }, 60000);

  it("--json names the failed file and its problem in the screenshots_failed summary", async () => {
    const { createServer } = await import("node:http");
    const srv = createServer((req, res) => {
      let body = ""; req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const b = JSON.parse(body || "{}");
        const data = req.url === "/act" && b.action === "screenshot" ? Buffer.from(jpeg(100, 100)).toString("base64") : undefined;
        res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, data }));
      });
    });
    await new Promise<void>((r) => srv.listen(0, r));
    const port = (srv.address() as { port: number }).port;
    const out: string[] = [];
    const w = vi.spyOn(process.stdout, "write").mockImplementation(((c: string) => { out.push(String(c)); return true; }) as never);
    const log = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { out.push(a.join(" ") + "\n"); });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try { await store(["screenshots", "--mode", "frames", "--out", "json-frames-bad", "--sim", `http://127.0.0.1:${port}`, "--json"]); }
    finally { w.mockRestore(); log.mockRestore(); err.mockRestore(); srv.close(); }
    const doc = JSON.parse(out.join(""));
    expect(doc.code).toBe("screenshots_failed");
    expect(doc.summary).toContain("json-frames-bad/iphone/01-start");
    process.exitCode = undefined;
  }, 60000);

  it("--json with a bad --mode is a usage error", async () => {
    const out: string[] = [];
    const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
    const w = vi.spyOn(process.stdout, "write").mockImplementation(((c: string) => { out.push(String(c)); return true; }) as never);
    const log = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { out.push(a.join(" ") + "\n"); });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try { await store(["screenshots", "--mode", "bogus", "--json"]); }
    finally { w.mockRestore(); log.mockRestore(); err.mockRestore(); exit.mockRestore(); }
    const doc = JSON.parse(out.join(""));
    expect(doc.code).toBe("usage");
    process.exitCode = undefined;
  });
});
