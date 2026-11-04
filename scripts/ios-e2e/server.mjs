#!/usr/bin/env node
// iOS e2e control plane server.
// Writes a text log (argv[4]) for CI grep checks and a JSONL log (argv[5] or <logFile>.jsonl)
// for programmatic analysis.
// Usage: node server.mjs <root> <port> <logFile> <textLogFile> [<jsonlFile>]
// Log format (text): METHOD PATH STATUS BYTES
// Log format (jsonl): { time, path, method, status, bytes }

import { createServer } from "node:http";
import { appendFileSync, existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";

const [root, port, logFile, textLogFile, jsonlFile] = [
  process.argv[2],
  Number(process.argv[3] || 8100),
  process.argv[4] || "server.log",
  process.argv[5] ?? logFile + ".txt",
  process.argv[6] ?? logFile + ".jsonl",
];
const log = (entry) => {
  const line = `${entry.method} ${entry.path} ${entry.status} ${entry.bytes ?? 0}\n`;
  appendFileSync(textLogFile, line);
  appendFileSync(jsonlFile, JSON.stringify(entry) + "\n");
};
createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const start = Date.now();
  if (req.method === "POST") {
    let b = ""; req.on("data", (d) => (b += d)).on("end", () => {
      const entry = { time: Date.now(), path: url.pathname, method: "POST", bytes: Buffer.byteLength(b) };
      log(entry);
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    });
    return;
  }
  const p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const f = [join(root, p), join(root, p + ".json")].find((x) => existsSync(x) && statSync(x).isFile());
  if (!f) {
    const entry = { time: Date.now(), path: url.pathname, method: "GET", status: 404, bytes: 0 };
    log(entry);
    return res.writeHead(404, { "content-type": "application/json" }).end('{"error":"not_found"}');
  }
  const bytes = statSync(f).size;
  const entry = { time: Date.now(), path: url.pathname, method: "GET", status: 200, bytes };
  log(entry);
  res.writeHead(200, { "content-type": f.endsWith(".json") ? "application/json" : "application/octet-stream" }).end(readFileSync(f));
}).listen(port, () => console.log(`e2e control plane on :${port}`));
