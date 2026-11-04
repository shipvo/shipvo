#!/usr/bin/env node
// A tiny stand-in control plane for the iOS simulator end-to-end: serves a static tree (signed pointers + bundles) and
// logs every request, including telemetry POSTs, so the workflow can assert what the app did.
//   node server.mjs <rootDir> <port> <logFile>
import { createServer } from "node:http";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize } from "node:path";

const [root, port, logFile] = [process.argv[2], Number(process.argv[3] || 8100), process.argv[4] || "server.log"];
const log = (entry) => appendFileSync(logFile, JSON.stringify(entry) + "\n");
createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const start = Date.now();
  if (req.method === "POST") {
    let b = ""; req.on("data", (d) => (b += d)).on("end", () => {
      const entry = { time: Date.now(), path: url.pathname, method: "POST", bytes: b.length };
      log(entry);
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    });
    return;
  }
  const p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const f = [join(root, p), join(root, p + ".json")].find((x) => existsSync(x) && statSync(x).isFile());
  if (!f) {
    const entry = { time: Date.now(), path: url.pathname, method: "GET", status: 404 };
    log(entry);
    return res.writeHead(404, { "content-type": "application/json" }).end('{"error":"not_found"}');
  }
  const bytes = statSync(f).size;
  const entry = { time: Date.now(), path: url.pathname, method: "GET", status: 200, bytes };
  log(entry);
  res.writeHead(200, { "content-type": f.endsWith(".json") ? "application/json" : "application/octet-stream" }).end(readFileSync(f));
}).listen(port, () => console.log(`e2e control plane on :${port}`));
