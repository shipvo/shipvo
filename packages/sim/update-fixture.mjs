// Test helper: a signed release pointer and a stub control plane that serves it (not shipped in the package).
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import http from "node:http";
import { canonical } from "./update.mjs";

export function makeKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicB64: publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64") };
}
export function signedPointer(key, release, html, over = {}) {
  const body = { schema_version: "1.0", app_id: "fx", release, kind: "web", web: { base: `r${release}`, entry: "index.html", sha256: createHash("sha256").update(html).digest("hex"), files: 1 }, ...over };
  return { ...body, signature: sign(null, Buffer.from(canonical(body)), key.privateKey).toString("base64") };
}
/** Serves /pointer.json and /<base>/index.html from `state` ({ pointer, files: { path: html } }). */
export async function stubControlPlane(state) {
  const srv = http.createServer((req, res) => {
    if (req.url === "/pointer.json") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(state.pointer)); }
    const f = state.files[req.url.slice(1)];
    if (f === undefined) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": "text/html" }); res.end(f);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() };
}
