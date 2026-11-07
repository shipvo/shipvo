// Helpers for scripts/ios-sim-check.sh: signing keys, a stored zip writer, signed pointers and the local update server.
import { createServer } from "node:http";
import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

export const APP_ID = "capacitor-sample";
export const SHELL_MAJOR = 1;

/** A fresh Ed25519 key pair. `publicKey` is the raw 32 bytes in base64, the form the app is built with. */
export function generateKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const x = publicKey.export({ format: "jwk" }).x;
  return { publicKey: Buffer.from(x, "base64url").toString("base64"), privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) };
}

/** Ed25519 signature (base64) over the exact UTF-8 bytes of `body`. */
export function signBody(body, privateKeyPem) {
  return sign(null, Buffer.from(body, "utf8"), createPrivateKey(privateKeyPem)).toString("base64");
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip with stored (uncompressed) entries. `files` is `{ [name]: string | Buffer }`. */
export function makeZip(files) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content), nm = Buffer.from(name), crc = crc32(data);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(data.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(nm.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(l, nm, data); central.push(c, nm);
    offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central), n = Object.keys(files).length;
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(n, 8); e.writeUInt16LE(n, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, e]);
}

/** The signed envelope for one archive. Pass `signWith` a different key to get a wrong signature. */
export function makePointer({ archive, release, band, platform = "ios", signWith, issuedAt = "2026-11-07T00:00:00Z" }) {
  const body = JSON.stringify({
    schema_version: "1.0", kind: "web", platform, app_id: APP_ID, shell_major: SHELL_MAJOR, band, release, issued_at: issuedAt,
    min_shell_version: "1.0.0",
    core: { version: "1.0.0", url: `r${release}.zip`, size: archive.length, sha256: createHash("sha256").update(archive).digest("hex") },
  });
  return { body, signature: signBody(body, signWith) };
}

/** The two page sets: the built app, and a page that throws at load and never reports healthy. */
export function bundleFiles(mode, wwwFiles) {
  if (mode === "crash") return { "index.html": "<!doctype html><html><body><script>throw new Error('crash at launch')</script></body></html>" };
  return wwwFiles;
}

/**
 * Update server for the simulator run. `mode` is read from `modeFile` on every request (good, crash or badsig), so the shell script
 * switches cases without a restart. Lines go to `eventsFile`: `version vN` when the app reports, `bundle N` when it downloads one.
 */
export function createUpdateServer({ keys, wrongKeys, wwwFiles, modeFile, eventsFile, release = 2 }) {
  const log = (line) => appendFileSync(eventsFile, line + "\n");
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    res.setHeader("access-control-allow-origin", "*");
    const mode = readFileSync(modeFile, "utf8").trim();
    const archive = makeZip(bundleFiles(mode, wwwFiles));
    const m = /^\/p\/[^/]+\/\d+\/ios\/(b\d+)$/.exec(url.pathname);
    if (m) {
      const p = makePointer({ archive, release, band: m[1], signWith: mode === "badsig" ? wrongKeys.privateKeyPem : keys.privateKeyPem });
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify(p)); log(`pointer ${mode}`);
    } else if (url.pathname === `/r${release}.zip`) { res.end(archive); log(`bundle ${release}`); }
    else if (url.pathname === "/__version") { res.end("ok"); log(`version ${url.searchParams.get("v")}`); }
    else res.writeHead(404).end();
  });
}
