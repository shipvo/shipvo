import { describe, it, expect } from "vitest";
import { ShipvoCapacitor, MemoryFiles, MemoryStore } from "@shipvo/capacitor";
// @ts-expect-error plain ES module without types
import { generateKeys, makeZip, makePointer, crc32, bundleFiles } from "../scripts/ios-sim-lib.mjs";
import { announceVersion, versionLabel } from "./launch.js";

describe("launch hook", () => {
  it("labels the served bundle", () => {
    expect(versionLabel("release-2.bundle")).toBe("v2");
    expect(versionLabel(undefined)).toBe("v1");
    expect(versionLabel("")).toBe("v1");
  });
  it("writes #version, logs and reports", async () => {
    const el = { textContent: "" };
    const urls: string[] = [];
    const doc = { getElementById: (id: string) => (id === "version" ? el : null) } as unknown as Document;
    const f = (async (u: string) => { urls.push(u); return new Response("ok"); }) as unknown as typeof fetch;
    await announceVersion("v2", "http://127.0.0.1:1/", doc, f);
    expect(el.textContent).toBe("v2");
    expect(urls).toEqual(["http://127.0.0.1:1/__version?v=v2"]);
  });
});

describe("ios-sim-check helpers", () => {
  it("writes a zip with the right entries and checksums", () => {
    const zip: Buffer = makeZip({ "index.html": "<p>hi</p>", "main.js": "1" });
    const e = zip.length - 22;
    expect(zip.readUInt32LE(e)).toBe(0x06054b50);
    expect(zip.readUInt16LE(e + 10)).toBe(2);
    let p = zip.readUInt32LE(e + 16);
    const names: string[] = [];
    for (let i = 0; i < 2; i++) {
      expect(zip.readUInt32LE(p)).toBe(0x02014b50);
      const size = zip.readUInt32LE(p + 24), nlen = zip.readUInt16LE(p + 28), local = zip.readUInt32LE(p + 42);
      names.push(zip.subarray(p + 46, p + 46 + nlen).toString());
      const start = local + 30 + zip.readUInt16LE(local + 26);
      expect(crc32(zip.subarray(start, start + size))).toBe(zip.readUInt32LE(p + 16));
      p += 46 + nlen;
    }
    expect(names).toEqual(["index.html", "main.js"]);
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("the crash bundle has only a page that throws", () => {
    expect(Object.keys(bundleFiles("crash", { "main.js": "x" }))).toEqual(["index.html"]);
    expect(bundleFiles("good", { "main.js": "x" })).toEqual({ "main.js": "x" });
  });

  async function check(wrong: boolean) {
    const keys = generateKeys(), other = generateKeys();
    const archive: Buffer = makeZip({ "index.html": "<p>v2</p>" });
    const f = (async (u: string) => {
      if (String(u).includes("/p/")) return Response.json(makePointer({ archive, release: 2, band: "b2", signWith: (wrong ? other : keys).privateKeyPem }));
      return new Response(new Uint8Array(archive));
    }) as unknown as typeof fetch;
    const files = new MemoryFiles();
    const sc = new ShipvoCapacitor({ appId: "capacitor-sample", shellMajor: 1, shellVersion: "1.0.0", platform: "ios", publicKey: keys.publicKey,
      baseUrl: "http://127.0.0.1:1", store: new MemoryStore(), files, fetch: f, random: () => 0.5 });
    return { sc, files, r: await sc.checkForUpdate({ apply: false }) };
  }
  it("the core accepts a pointer signed by the build key", async () => {
    const { r, sc } = await check(false);
    expect(r.status).toBe("staged");
    expect((await sc.getState()).pendingRelease).toBe(2);
  });
  it("the core refuses a pointer signed by another key", async () => {
    const { r, sc, files } = await check(true);
    expect(r).toMatchObject({ status: "error", error: expect.stringMatching(/signature/) });
    expect((await sc.getState()).pendingRelease).toBe(0);
    expect(files.files.size).toBe(0);
  });
});
