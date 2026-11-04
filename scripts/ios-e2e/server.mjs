#!/usr/bin/env node
// A tiny stand-in control plane for the iOS simulator end-to-end: serves a static tree (signed pointers + bundles) and
// logs every request, including telemetry POSTs, so the workflow can assert what the app did.
//   node server.mjs <rootDir> <port> <logFile>
import { createServer } from "node:http";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize } from "node:path";

const [root, port, logFile, jsonLogFile = "server.jsonl"] = [process.argv[2], Number(process.argv[3] || 8100), process.argv[4] || "server.log", process.argv[5]];
const log = (o) => {
  appendFileSync(logFile, JSON.stringify(o) + "\n");
  appendFileSync(jsonLogFile, JSON.stringify(o) + "\n");
};
createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "POST") {
    let b = ""; req.on("data", (d) => (b += d)).on("end", () => { const body = '{"ok":true}'; log({ time: Date.now(), path: url.pathname, bytes: Buffer.byteLength(body) }); res.writeHead(200, { "content-type": "application/json" }).end(body); });
    return;
  }
  const p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const f = [join(root, p), join(root, p + ".json")].find((x) => existsSync(x) && statSync(x).isFile());
  if (!f) { const body = '{"error":"not_found"}'; log({ time: Date.now(), path: url.pathname, bytes: Buffer.byteLength(body) }); return res.writeHead(404, { "content-type": "application/json" }).end(body); }
  const data = readFileSync(f);
  log({ time: Date.now(), path: url.pathname, bytes: data.length });
  res.writeHead(200, { "content-type": f.endsWith(".json") ? "application/json" : "application/octet-stream" }).end(data);
}).listen(port, () => console.log(`e2e control plane on :${port}`));
