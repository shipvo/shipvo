import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadHosted } from "../src/sim-hosted";

let srv: http.Server | undefined; let dir = "";
afterEach(() => { srv?.close(); srv = undefined; rmSync(dir, { recursive: true, force: true }); });
const project = () => { dir = mkdtempSync(join(tmpdir(), "sim-hosted-")); mkdirSync(join(dir, "sim-dist")); writeFileSync(join(dir, "sim-dist", "index.html"), "<html>x</html>"); return dir; };
const serve = (h: http.RequestListener) => new Promise<string>((ok) => { srv = http.createServer(h).listen(0, "127.0.0.1", () => ok(`http://127.0.0.1:${(srv!.address() as { port: number }).port}`)); });

describe("shipvo sim --hosted", () => {
  it("uploads sim-dist for the key and returns the open_app target", async () => {
    let seen = { auth: "", type: "", app: "", bytes: 0 };
    const url = await serve(async (req, res) => {
      const c: Buffer[] = []; for await (const x of req) c.push(x as Buffer);
      seen = { auth: req.headers.authorization ?? "", type: String(req.headers["content-type"]), app: new URL(req.url!, "http://x").searchParams.get("app")!, bytes: Buffer.concat(c).length };
      res.writeHead(201, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "b7", expires_at: "2026-11-08T00:00:00Z" }));
    });
    const r = await uploadHosted({ root: project(), skipBuild: true, key: "k1", url, app: "myapp" });
    expect(r).toMatchObject({ id: "b7", open: "myapp@build:b7" });
    expect(seen).toMatchObject({ auth: "Bearer k1", type: "application/gzip", app: "myapp" });
    expect(seen.bytes).toBeGreaterThan(0);
  });

  it("says how to make a too-large build smaller", async () => {
    const url = await serve((_q, res) => { res.writeHead(413, { "content-type": "application/json" }); res.end(JSON.stringify({ code: "build_too_large", error: "The build is over the size limit" })); });
    await expect(uploadHosted({ root: project(), skipBuild: true, key: "k1", url, app: "myapp" })).rejects.toMatchObject({ code: "build_too_large", message: expect.stringMatching(/make it smaller/) });
  });

  it("needs a key", async () => {
    const prev = process.env.SHIPVO_API_KEY; delete process.env.SHIPVO_API_KEY;
    try { await expect(uploadHosted({ root: project(), skipBuild: true, app: "myapp" })).rejects.toMatchObject({ code: "no_api_key" }); }
    finally { if (prev !== undefined) process.env.SHIPVO_API_KEY = prev; }
  });
});
