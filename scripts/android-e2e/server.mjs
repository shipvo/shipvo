#!/usr/bin/env node
// Local release server for the Android device lab: serves a static tree (signed pointers + bundles) and logs every
// request as one JSON line, including telemetry POST bodies. The emulator reaches it at http://10.0.2.2:<port>.
//   node server.mjs <rootDir> <port> <logFile>
import { createServer } from "node:http";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function startServer(root, port, logFile) {
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
    res.writeHead(200, { "content-type": f.endsWith(".json") ? "application/json" : "application/octet-stream", "content-length": data.length });
    res.end(data, () => log({ method: "GET", path: url.pathname, status: 200, bytes: data.length }));
  });
  return new Promise((ok) => server.listen(port, "0.0.0.0", () => ok(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [root, port, logFile] = [process.argv[2], Number(process.argv[3] || 8110), process.argv[4] || "server.log"];
  await startServer(root, port, logFile); console.log(`android e2e control plane on :${port}`);
}
