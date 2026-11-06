import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureInstallIdentity } from "../../../packages/runtime/src/install";
import { createTelemetryStorage, rnCrypto, rnStorage, telemetryDeps } from "./telemetry";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const enc = (s: string) => new TextEncoder().encode(s);
afterEach(() => vi.unstubAllGlobals());

describe("rnCrypto", () => {
  it("matches RFC 4231 case 1", () => {
    const key = new Uint8Array(20).fill(0x0b);
    expect(hex(rnCrypto.hmacSha256(key, enc("Hi There")) as Uint8Array))
      .toBe("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
  });
  it("matches RFC 4231 case 2", () => {
    expect(hex(rnCrypto.hmacSha256(enc("Jefe"), enc("what do ya want for nothing?")) as Uint8Array))
      .toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });
  it("handles keys and data longer than one block (RFC 4231 case 6)", () => {
    const key = new Uint8Array(131).fill(0xaa);
    expect(hex(rnCrypto.hmacSha256(key, enc("Test Using Larger Than Block-Size Key - Hash Key First")) as Uint8Array))
      .toBe("60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54");
  });
  it("gives random bytes", () => {
    const a = rnCrypto.randomBytes(16) as Uint8Array;
    expect(a.length).toBe(16);
  });
});

describe("rnStorage", () => {
  it("round-trips through an injected backend", async () => {
    const data = new Map<string, string>();
    const s = createTelemetryStorage({ getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => { data.set(k, v); } });
    expect(await s.getItem("a")).toBeNull();
    await s.setItem("a", "1");
    expect(await s.getItem("a")).toBe("1");
    expect(data.get("a")).toBe("1");
  });
  it("default in-memory storage round-trips", async () => {
    await rnStorage.setItem("x", "y");
    expect(await rnStorage.getItem("x")).toBe("y");
  });
});

describe("telemetryDeps with ensureInstallIdentity", () => {
  it("registers once and reuses the identity", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ key: "secret-key" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const a = await ensureInstallIdentity(telemetryDeps.storage, telemetryDeps.crypto, "https://x.test/register");
    expect(a?.key).toBe("secret-key");
    expect(a?.install_id).toMatch(/^[0-9a-f]{32}$/);
    const b = await ensureInstallIdentity(telemetryDeps.storage, telemetryDeps.crypto, "https://x.test/register");
    expect(b).toEqual(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
