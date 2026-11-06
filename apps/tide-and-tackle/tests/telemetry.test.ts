import { test, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
// The runtime index pulls in React Native native-module code that Node cannot parse. The signing code under test is in install.ts.
vi.mock("@shipvo/runtime", async () => await import("../../../packages/runtime/src/install"));
import { createReporter, signedBody } from "../src/telemetry";

const crypto = {
  randomBytes: (n: number) => new Uint8Array(n).fill(7),
  hmacSha256: (k: Uint8Array, d: Uint8Array) => new Uint8Array(createHmac("sha256", k).update(d).digest()),
};
const memory = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

function verify(sent: string, key: string) {
  const m = /,"sig":"([0-9a-f]{64})"\}$/.exec(sent)!;
  const unsigned = sent.slice(0, m.index) + "}";
  expect(createHmac("sha256", key).update(unsigned).digest("hex")).toBe(m[1]);
  return JSON.parse(sent);
}

test("reports are signed with the registered key and verify the way the server checks them", async () => {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => { calls.push(url); return new Response(JSON.stringify({ key: "k-secret" })); }) as any;
  try {
    const st = memory();
    const r = createReporter("https://cp.test", st, crypto);
    const sent = await r.body({ schema_version: "1.0", event: "applied", release: 3 });
    const parsed = verify(sent, "k-secret");
    expect(parsed.install_id).toBe("07".repeat(16));
    expect(parsed.event).toBe("applied");
    await r.body({ event: "x" });
    expect(calls).toEqual(["https://cp.test/t/register"]); // registered once
    expect(st.m.size).toBe(1);
  } finally { globalThis.fetch = realFetch; }
});

test("when registration fails, the report goes out unsigned", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("no", { status: 503 })) as any;
  try {
    const sent = await createReporter("https://cp.test", memory(), crypto).body({ event: "applied" });
    expect(sent).toBe('{"event":"applied"}');
  } finally { globalThis.fetch = realFetch; }
});

test("signedBody falls back to plain JSON without an identity", async () => {
  expect(await signedBody(null, { a: 1 }, crypto)).toBe('{"a":1}');
});
