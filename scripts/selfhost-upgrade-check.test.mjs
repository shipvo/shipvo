import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seed, verify, CheckError } from "./selfhost-upgrade-check.mjs";

const res = (status, text) => ({ status, text: async () => text });
const quiet = () => {};

// Fake control plane: keeps pointers in a map, like the real one keeps them in the volume.
function fakeServer() {
  const store = new Map();
  const fetchFn = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (init.method === "POST" && path === "/apps") return res(201, JSON.stringify({ publish_token: "tok" }));
    if (init.method === "PUT") { store.set(path.split("/kv")[1], init.body); return res(200, "{}"); }
    const v = store.get(path);
    return v === undefined ? res(404, '{"error":"not_found"}') : res(200, v);
  };
  return { store, fetchFn };
}

const tmpFile = async () => join(await mkdtemp(join(tmpdir(), "upgrade-")), "state.json");

test("seed writes appId and pointer; verify passes against the same server", async () => {
  const s = fakeServer(); const file = await tmpFile();
  const { appId } = await seed({ baseUrl: "http://x/", file, fetchFn: s.fetchFn, log: quiet });
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.appId, appId);
  assert.equal(saved.pointer, s.store.get(`/p/${appId}/1/b0`));
  await verify({ baseUrl: "http://x", file, fetchFn: s.fetchFn, log: quiet });
});

test("verify fails with a clear message on an empty server", async () => {
  const file = await tmpFile();
  await seed({ baseUrl: "http://x", file, fetchFn: fakeServer().fetchFn, log: quiet });
  await assert.rejects(verify({ baseUrl: "http://x", file, fetchFn: fakeServer().fetchFn, log: quiet }), (e) => e instanceof CheckError && /data lost/.test(e.message));
});

test("verify fails when the pointer changed", async () => {
  const s = fakeServer(); const file = await tmpFile();
  const { appId } = await seed({ baseUrl: "http://x", file, fetchFn: s.fetchFn, log: quiet });
  s.store.set(`/p/${appId}/1/b0`, "other");
  await assert.rejects(verify({ baseUrl: "http://x", file, fetchFn: s.fetchFn, log: quiet }), /differs/);
});

test("verify without a seed file says to run seed", async () => {
  await assert.rejects(verify({ baseUrl: "http://x", file: join(await mkdtemp(join(tmpdir(), "upgrade-")), "none.json"), fetchFn: fakeServer().fetchFn, log: quiet }), /run "seed" first/);
});

test("seed fails when the app cannot be created", async () => {
  await assert.rejects(seed({ baseUrl: "http://x", file: await tmpFile(), fetchFn: async () => res(401, "no"), log: quiet }), /create app: HTTP 401/);
});
