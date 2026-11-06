import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { b64, keyFromSeed } from "../src/index";
import { makeRotation, checkRotation, acceptedKeys, type TrustState } from "../src/rotation";

const seed = () => b64(randomBytes(32));
const pub = (s: string) => b64(keyFromSeed(s).publicKey);
const root = seed(), rel = seed(), next = seed();
const trust: TrustState = { appId: "tide", rootKey: pub(root), releaseKey: pub(rel), sequence: 0 };
const body = (o = {}) => ({ appId: "tide", sequence: 1, previousKey: pub(rel), newKey: pub(next), validFrom: new Date().toISOString(), revokeOldAfter: null, ...o });

describe("key rotation statements", () => {
  it("accepts a root-signed statement", () => expect(checkRotation(makeRotation(body(), root), trust)).toBeNull());
  it("rejects one signed by the old release key", () => expect(checkRotation(makeRotation(body(), rel), trust)).toBe("bad_signature"));
  it("rejects a forged root", () => expect(checkRotation(makeRotation(body(), seed()), trust)).toBe("bad_signature"));
  it("rejects a tampered new key", () => expect(checkRotation({ ...makeRotation(body(), root), newKey: pub(seed()) }, trust)).toBe("bad_signature"));
  it("rejects a replayed or older sequence", () => {
    const st = makeRotation(body(), root);
    expect(checkRotation(st, { ...trust, releaseKey: pub(next), sequence: 1 })).toBe("replayed");
    expect(checkRotation(st, { ...trust, sequence: 5 })).toBe("replayed");
  });
  it("rejects wrong app, wrong previous key, future validFrom", () => {
    expect(checkRotation(makeRotation(body({ appId: "other" }), root), trust)).toBe("wrong_app");
    expect(checkRotation(makeRotation(body({ previousKey: pub(seed()) }), root), trust)).toBe("wrong_previous_key");
    expect(checkRotation(makeRotation(body({ validFrom: new Date(Date.now() + 86_400_000).toISOString() }), root), trust)).toBe("not_yet_valid");
  });
  it("revokes the old key at once or after the grace time", () => {
    const now = Date.now() + 10;
    expect(acceptedKeys(makeRotation(body(), root), now)).toEqual([pub(next)]);
    const grace = makeRotation(body({ revokeOldAfter: new Date(now + 1000).toISOString() }), root);
    expect(acceptedKeys(grace, now)).toEqual([pub(next), pub(rel)]);
    expect(acceptedKeys(grace, now + 2000)).toEqual([pub(next)]);
  });
});
