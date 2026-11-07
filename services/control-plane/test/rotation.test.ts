import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";
import app from "../src/index";
import { listRotations, listRotationLog, getRootKey, highestSequence } from "../src/rotation-store";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const mig = (n: string) => readFileSync(new URL(`../migrations/${n}`, import.meta.url), "utf8");
const V = JSON.parse(readFileSync(new URL("../../../packages/runtime/test-vectors/rotation.json", import.meta.url), "utf8"));
const envs = (id: number) => V.cases.find((c: any) => c.id === id).steps.flatMap((s: any) => s.deliver) as { body: string; signature: string }[];

function wrap(sql: any) {
  return { prepare: (q: string) => { const st = sql.prepare(q); let b: any[] = []; const o: any = {
    bind: (...a: any[]) => { b = a; return o; }, first: async () => st.get(...b) ?? null, all: async () => ({ results: st.all(...b) }), run: async () => ({ meta: { changes: st.run(...b).changes } }) }; return o; } } as any;
}
function setup() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(mig("0016_audit_log.sql")); sql.exec(mig("0023_key_rotation.sql"));
  const DB = wrap(sql);
  return { DB, e: { DB, POINTERS: {}, OWNER_TOKEN: "owner-secret", ADMIN_PASSWORD: "pw" } as any };
}
async function cookie(appId = "tide") {
  const exp = Date.now() + 3600_000;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("pw"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${appId}.${exp}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { cookie: `pn_admin=${appId}.${exp}.${sig}` };
}
const send = (e: any, method: string, path: string, headers: Record<string, string>, body: unknown) =>
  app.request(path, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }, e);
const register = async (e: any, pub = V.root.publicKey) => send(e, "PUT", "/rotation/tide/root", await cookie(), { root_key: pub });
const upload = async (e: any, env: unknown) => send(e, "POST", "/rotation/tide", await cookie(), env);
const j = async (r: Response) => (await r.json()) as any;

function signed(seq: number, validFrom = "2026-11-06T00:00:00.000Z") {
  const body = JSON.stringify({ type: "key-rotation", appId: "tide", sequence: seq, newKey: V.keys.K2.publicKey, validFrom });
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(V.root.seed, "base64")]);
  return { body, signature: sign(null, Buffer.from(body), createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" })).toString("base64") };
}

describe("admin session only", () => {
  for (const [name, headers] of [["a publish token", { authorization: "Bearer sv_publish_x" }], ["the owner token", { authorization: "Bearer owner-secret" }]] as const) {
    it(`${name} alone gets 403 on both routes and changes nothing`, async () => {
      const { e, DB } = setup();
      expect((await send(e, "PUT", "/rotation/tide/root", headers, { root_key: V.root.publicKey })).status).toBe(403);
      await register(e);
      expect((await send(e, "POST", "/rotation/tide", headers, envs(1)[0])).status).toBe(403);
      expect(await highestSequence(DB, "tide")).toBe(0);
      expect(await listRotationLog(DB, "tide")).toEqual([]);
    });
  }
  it("no credentials get 401", async () => {
    const { e } = setup();
    expect((await send(e, "PUT", "/rotation/tide/root", {}, { root_key: V.root.publicKey })).status).toBe(401);
    expect((await send(e, "POST", "/rotation/tide", {}, envs(1)[0])).status).toBe(401);
  });
  it("an admin session for another app gets 401", async () => {
    const { e } = setup();
    expect((await send(e, "PUT", "/rotation/tide/root", await cookie("other"), { root_key: V.root.publicKey })).status).toBe(401);
  });
});

describe("PUT /rotation/<app>/root", () => {
  it("registers a root key and replaces it", async () => {
    const { e, DB } = setup();
    expect((await register(e)).status).toBe(200);
    expect(await getRootKey(DB, "tide")).toBe(V.root.publicKey);
    await register(e, V.forgedRoot.publicKey);
    expect(await getRootKey(DB, "tide")).toBe(V.forgedRoot.publicKey);
  });
  it("refuses a key that is not 32 bytes", async () => {
    const { e, DB } = setup();
    const r = await send(e, "PUT", "/rotation/tide/root", await cookie(), { root_key: "AAAA" });
    expect(r.status).toBe(400);
    expect(await getRootKey(DB, "tide")).toBeNull();
  });
});

describe("POST /rotation/<app>", () => {
  it("stores a valid statement and writes an audit row", async () => {
    const { e, DB } = setup(); await register(e);
    const r = await upload(e, envs(1)[0]);
    expect(r.status).toBe(200);
    expect((await listRotations(DB, "tide")).map((x) => x.sequence)).toEqual([1]);
    const log = await listRotationLog(DB, "tide");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ app_id: "tide", actor: "owner (admin)", sequence: 1, valid_from: "2026-11-06T00:00:00.000Z" });
  });
  it("needs a registered root key", async () => {
    const { e } = setup();
    expect((await upload(e, envs(1)[0])).status).toBe(409);
  });
  it("replay: the same envelope twice is refused and logged once", async () => {
    const { e, DB } = setup(); await register(e);
    expect((await upload(e, envs(1)[0])).status).toBe(200);
    const r = await upload(e, envs(1)[0]);
    expect(r.status).toBe(409);
    expect((await j(r)).reason).toBe("replay");
    expect(await listRotationLog(DB, "tide")).toHaveLength(1);
  });
  it("wrong sequence: a lower sequence after a higher one is refused", async () => {
    const { e, DB } = setup(); await register(e);
    expect((await upload(e, signed(5))).status).toBe(200);
    expect((await upload(e, signed(3))).status).toBe(409);
    expect((await upload(e, signed(5, "2026-11-07T00:00:00.000Z"))).status).toBe(409);
    expect(await highestSequence(DB, "tide")).toBe(5);
    expect(await listRotationLog(DB, "tide")).toHaveLength(1);
  });
  it("wrong sequence: 0, negative and fractional numbers are refused", async () => {
    const { e } = setup(); await register(e);
    for (const n of [0, -1, 1.5]) expect((await j(await upload(e, signed(n)))).reason).toBe("bad_sequence");
  });
  it("chain cap: with 10 stored the phone list holds the 8 highest, ascending", async () => {
    const { e, DB } = setup(); await register(e);
    for (const x of [1, 2]) expect((await upload(e, signed(x))).status).toBe(200);
    for (const env of envs(9)) expect((await upload(e, env)).status).toBe(200);
    expect((await listRotations(DB, "tide")).map((x) => x.sequence)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(await listRotationLog(DB, "tide")).toHaveLength(10);
  });
  it("refuses a statement signed by a forged root key or by a release key", async () => {
    const { e, DB } = setup(); await register(e);
    for (const id of [2, 3]) {
      const r = await upload(e, envs(id)[0]);
      expect(r.status).toBe(400);
      expect((await j(r)).reason).toBe("bad_signature");
    }
    expect(await highestSequence(DB, "tide")).toBe(0);
    expect(await listRotationLog(DB, "tide")).toEqual([]);
  });
  it("refuses a statement for another app, a wrong type and a bad envelope", async () => {
    const { e } = setup(); await register(e);
    const other = await send(e, "POST", "/rotation/other", await cookie("other"), envs(1)[0]);
    expect(other.status).toBe(409); // no root key for "other"
    const tampered = { ...envs(1)[0], body: envs(1)[0].body.replace("tide", "tidx") };
    expect((await j(await upload(e, tampered))).reason).toBe("bad_signature");
    expect((await j(await upload(e, { body: 1, signature: 2 }))).reason).toBe("bad_envelope");
    expect((await j(await upload(e, { body: "x".repeat(1025), signature: "AA==" }))).reason).toBe("bad_envelope");
  });
});
