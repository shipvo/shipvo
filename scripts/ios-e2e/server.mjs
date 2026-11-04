#!/usr/bin/env node
// A tiny stand-in control plane for the iOS simulator end-to-end: serves a static tree (signed pointers + bundles) and
// logs every request, including telemetry POSTs, so the workflow can assert what the app did.
//   node server.mjs <rootDir> <port> <logFile> [jsonLogFile]
// Text lines go to logFile (kept for the workflow's grep checks); JSON lines go to jsonLogFile (or logFile + ".jsonl")
// for the analyzer.
import { createServer } from "node:http";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize } from "node:path";

const [root, port, logFile] = [process.argv[2], Number(process.argv[3] || 8100), process.argv[4] || "server.log"];
const jsonLogFile = process.argv[5] || logFile + ".jsonl";
const logText = (line) => appendFileSync(logFile, line + "\n");
const logJson = (entry) => appendFileSync(jsonLogFile, JSON.stringify(entry) + "\n");
createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "POST") {
    let b = ""; req.on("data", (d) => (b += d)).on("end", () => {
      const body = '{"ok":true}';
      // bytes is the response size ("bytes sent"), not the request body size.
      logText(`POST ${url.pathname} ${b.slice(0, 2000)}`);
      logJson({ time: Date.now(), path: url.pathname, bytes: Buffer.byteLength(body), status: 200 });
      res.writeHead(200, { "content-type": "application/json" }).end(body);
    });
    return;
  }
  const p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const f = [join(root, p), join(root, p + ".json")].find((x) => existsSync(x) && statSync(x).isFile());
  if (!f) {
    const body = '{"error":"not_found"}';
    logText(`GET ${url.pathname} 404`);
    logJson({ time: Date.now(), path: url.pathname, bytes: Buffer.byteLength(body), status: 404 });
    return res.writeHead(404, { "content-type": "application/json" }).end(body);
  }
  const body = readFileSync(f);
  logText(`GET ${url.pathname} 200`);
  logJson({ time: Date.now(), path: url.pathname, bytes: body.length, status: 200 });
  res.writeHead(200, { "content-type": f.endsWith(".json") ? "application/json" : "application/octet-stream" }).end(body);
}).listen(port, () => console.log(`e2e control plane on :${port}`));
