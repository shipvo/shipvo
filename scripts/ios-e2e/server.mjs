#!/usr/bin/env node
// A tiny stand-in control plane for the iOS simulator end-to-end: serves a static tree (signed pointers + bundles) and
// logs every request, including telemetry POSTs, so the workflow can assert what the app did.
//   node server.mjs <rootDir> <port> <logFile> [jsonLogFile]
// Text lines (GET <path> <status>, POST <path> <body>) go to logFile. JSON lines go to jsonLogFile only when given.
import { createServer } from "node:http";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize } from "node:path";

const [root, port, logFile, jsonLogFile] = [process.argv[2], Number(process.argv[3] || 8100), process.argv[4] || "server.log", process.argv[5]];
const textLog = (line) => appendFileSync(logFile, line + "\n");
const jsonLog = (o) => { if (jsonLogFile) appendFileSync(jsonLogFile, JSON.stringify(o) + "\n"); };
createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "POST") {
    let b = ""; req.on("data", (d) => (b += d)).on("end", () => { const body = '{"ok":true}'; textLog(`POST ${url.pathname} ${b}`); jsonLog({ time: Date.now(), path: url.pathname, bytes: Buffer.byteLength(body) }); res.writeHead(200, { "content-type": "application/json" }).end(body); });
    return;
  }
  const p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const f = [join(root, p), join(root, p + ".json")].find((x) => existsSync(x) && statSync(x).isFile());
  if (!f) { const body = '{"error":"not_found"}'; textLog(`GET ${url.pathname} 404`); jsonLog({ time: Date.now(), path: url.pathname, bytes: Buffer.byteLength(body) }); return res.writeHead(404, { "content-type": "application/json" }).end(body); }
  const data = readFileSync(f);
  textLog(`GET ${url.pathname} 200`);
  jsonLog({ time: Date.now(), path: url.pathname, bytes: data.length });
  res.writeHead(200, { "content-type": f.endsWith(".json") ? "application/json" : "application/octet-stream" }).end(data);
}).listen(port, () => console.log(`e2e control plane on :${port}`));
