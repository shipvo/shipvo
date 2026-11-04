#!/usr/bin/env node
// A tiny stand-in control plane for the iOS simulator end-to-end: serves a static tree (signed pointers + bundles) and
// logs every request, including telemetry POSTs, so the workflow can assert what the app did.
//   node server.mjs <rootDir> <port> <logFile> [jsonLogFile]
// <logFile> keeps the text lines the workflow greps. <jsonLogFile> (default <logFile>.jsonl) gets one JSON line per
// request: {"t": ms since epoch, "path": "/b/x", "bytes": body bytes sent}. t is taken when the response is finished.
import { createServer } from "node:http";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize } from "node:path";

const [root, port, logFile] = [process.argv[2], Number(process.argv[3] || 8100), process.argv[4] || "server.log"];
const jsonLog = process.argv[5] || logFile + ".jsonl";
const log = (s) => appendFileSync(logFile, s + "\n");
createServer((req, res) => {
  let bytes = 0;
  const write = res.write.bind(res), end = res.end.bind(res);
  const count = (c) => { if (c != null && typeof c !== "function") bytes += Buffer.byteLength(c); };
  res.write = (c, ...a) => { count(c); return write(c, ...a); };
  res.end = (c, ...a) => { count(c); return end(c, ...a); };
  res.on("finish", () => appendFileSync(jsonLog, JSON.stringify({ t: Date.now(), path: new URL(req.url, "http://x").pathname, bytes }) + "\n"));
  const url = new URL(req.url, "http://x");
  if (req.method === "POST") {
    let b = ""; req.on("data", (d) => (b += d)).on("end", () => { log(`POST ${url.pathname} ${b.slice(0, 2000)}`); res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}'); });
    return;
  }
  const p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const f = [join(root, p), join(root, p + ".json")].find((x) => existsSync(x) && statSync(x).isFile());
  if (!f) { log(`GET ${url.pathname} 404`); return res.writeHead(404, { "content-type": "application/json" }).end('{"error":"not_found"}'); }
  const data = readFileSync(f), type = f.endsWith(".json") ? "application/json" : "application/octet-stream";
  // Range support (bytes=<n>-), like the real control plane, so resumed downloads can be tested.
  const m = /^bytes=(\d+)-$/.exec(req.headers.range || "");
  if (m) {
    const start = Number(m[1]);
    if (start >= data.length) { log(`GET ${url.pathname} 416`); return res.writeHead(416, { "content-range": `bytes */${data.length}` }).end(); }
    log(`GET ${url.pathname} 206 from ${start}`);
    return res.writeHead(206, { "content-type": type, "accept-ranges": "bytes", "content-length": data.length - start,
      "content-range": `bytes ${start}-${data.length - 1}/${data.length}` }).end(data.subarray(start));
  }
  log(`GET ${url.pathname} 200`);
  res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "content-length": data.length }).end(data);
}).listen(port, () => console.log(`e2e control plane on :${port}`));
