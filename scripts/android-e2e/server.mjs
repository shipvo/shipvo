#!/usr/bin/env node
// Local release server for the Android device lab: serves a static tree (signed pointers + bundles) and logs every
// request as one JSON line, including telemetry POST bodies. The emulator reaches it at http://10.0.2.2:<port>.
//   node server.mjs <rootDir> <port> <logFile>
// Option `cutFirst: { path, fraction }` (startServer only): the first GET of that path sends `fraction` of the bytes (a caller may set `path` later and reset `done`) and
// then drops the connection. Later GETs of it honour `Range: bytes=<n>-` with a 206. Without the option nothing changes.
import { createServer } from "node:http";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function startServer(root, port, logFile, { cutFirst } = {}) {
  const base = resolve(root);
  const log = (o) => appendFileSync(logFile, JSON.stringify({ t: Date.now(), ...o }) + "\n");
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "POST") {
      let b = ""; req.on("data", (d) => (b += d)).on("end", () => { log({ method: "POST", path: url.pathname, status: 200, body: b.slice(0, 4000) }); res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}'); });
      return;
    }
    const target = resolve(base, "." + normalize("/" + decodeURIComponent(url.pathname)));
    const f = target.startsWith(base) ? [target, target + ".json"].find((x) => existsSync(x) && statSync(x).isFile()) : null;
    if (!f) { log({ method: "GET", path: url.pathname, status: 404, bytes: 0 }); return res.writeHead(404, { "content-type": "application/json" }).end('{"error":"not_found"}'); }
    const data = readFileSync(f);
    if (cutFirst && url.pathname === cutFirst.path) {
      const range = req.headers.range, entry = { method: "GET", path: url.pathname, ...(range ? { range } : {}) };
      if (!cutFirst.done && !range) {
        cutFirst.done = true;
        const n = Math.max(1, Math.floor(data.length * cutFirst.fraction));
        res.writeHead(200, { "content-type": "application/octet-stream", "content-length": data.length });
        res.write(data.subarray(0, n), () => { log({ ...entry, status: 200, bytes: n, cut: true }); req.socket.destroy(); });
        return;
      }
      const start = Number(/^bytes=(\d+)-/.exec(range ?? "")?.[1] ?? 0);
      if (start > 0 && start < data.length) {
        const body = data.subarray(start);
        res.writeHead(206, { "content-type": "application/octet-stream", "content-length": body.length, "content-range": `bytes ${start}-${data.length - 1}/${data.length}` });
        return res.end(body, () => log({ ...entry, status: 206, bytes: body.length }));
      }
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": data.length });
      return res.end(data, () => log({ ...entry, status: 200, bytes: data.length }));
    }
    res.writeHead(200, { "content-type": f.endsWith(".json") ? "application/json" : "application/octet-stream", "content-length": data.length });
    res.end(data, () => log({ method: "GET", path: url.pathname, status: 200, bytes: data.length }));
  });
  return new Promise((ok) => server.listen(port, "0.0.0.0", () => ok(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [root, port, logFile] = [process.argv[2], Number(process.argv[3] || 8110), process.argv[4] || "server.log"];
  await startServer(root, port, logFile); console.log(`android e2e control plane on :${port}`);
}
