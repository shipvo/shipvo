import { describe, it, expect, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { b64, keyFromSeed } from "../src/index";
import { makeRotation, checkRotation, acceptedKeys, rotationCmd, type TrustState } from "../src/rotation";

const seed = () => b64(randomBytes(32));
const pub = (s: string) => b64(keyFromSeed(s).publicKey);
const root = seed(), rel = seed(), next = seed();
const trust: TrustState = { appId: "tide", rootKey: pub(root), releaseKey: pub(rel), sequence: 0 };
const body = (o = {}) => ({ appId: "tide", sequence: 1, previousKey: pub(rel), newKey: pub(next), validFrom: new Date(Date.now() - 1000).toISOString(), revokeOldAfter: null, ...o });

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

describe("shipvo keys rotate", () => {
  const rootSeed = seed();
  const setup = (cfg: object = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "rot-"));
    writeFileSync(join(dir, "shipvo.json"), JSON.stringify({ appId: "tide", controlPlane: "https://x.test", publicKey: pub(rel), rootKey: pub(rootSeed), ...cfg }));
    writeFileSync(join(dir, "root.txt"), rootSeed + "\n");
    return dir;
  };
  const run = async (dir: string, rest: string[]) => {
    const cwd = process.cwd();
    process.chdir(dir);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try { return await rotationCmd("rotate", rest); } finally { err.mockRestore(); log.mockRestore(); process.chdir(cwd); }
  };
  const read = (dir: string, n: number) => JSON.parse(readFileSync(join(dir, ".shipvo", "rotations", `${n}.json`), "utf8"));

  it("fails without rootKey in shipvo.json", async () => {
    const dir = setup({ rootKey: undefined });
    expect(await run(dir, ["--root-seed-file", join(dir, "root.txt")])).toBe(1);
    expect(existsSync(join(dir, ".shipvo"))).toBe(false);
  });
  it("fails when the root seed does not match rootKey", async () => {
    const dir = setup({ rootKey: pub(seed()) });
    expect(await run(dir, ["--root-seed-file", join(dir, "root.txt")])).toBe(1);
    expect(existsSync(join(dir, ".shipvo"))).toBe(false);
  });
  it("writes a chain of statements that pass checkRotation", async () => {
    const dir = setup();
    const f = ["--root-seed-file", join(dir, "root.txt")];
    expect(await run(dir, f)).toBe(0);
    const one = read(dir, 1);
    expect(one.sequence).toBe(1);
    expect(one.previousKey).toBe(pub(rel));
    expect(checkRotation(one, { appId: "tide", rootKey: pub(rootSeed), releaseKey: pub(rel), sequence: 0 })).toBeNull();
    expect(one.revokeOldAfter).not.toBeNull();
    // The seed for the key rotation #1 names must not be overwritten.
    const seedPath = join(dir, ".shipvo", "seed.next.txt");
    const firstSeed = readFileSync(seedPath, "utf8");
    expect(pub(firstSeed.trim())).toBe(one.newKey);
    expect(await run(dir, f)).toBe(1);
    expect(readFileSync(seedPath, "utf8")).toBe(firstSeed);
    expect(existsSync(join(dir, ".shipvo", "rotations", "2.json"))).toBe(false);
    // After the owner moves the seed away, rotation #2 chains from #1.
    renameSync(seedPath, join(dir, "seed.1.txt"));
    expect(await run(dir, f)).toBe(0);
    const two = read(dir, 2);
    expect(two.sequence).toBe(2);
    expect(two.previousKey).toBe(one.newKey);
    expect(checkRotation(two, { appId: "tide", rootKey: pub(rootSeed), releaseKey: one.newKey, sequence: 1 })).toBeNull();
  });
  it("fails cleanly on a bad root seed file", async () => {
    const dir = setup();
    for (const [name, text] of [["empty.txt", ""], ["short.txt", "abcd\n"]]) {
      writeFileSync(join(dir, name), text);
      expect(await run(dir, ["--root-seed-file", join(dir, name)])).toBe(1);
    }
    expect(await run(dir, ["--root-seed-file", join(dir, "missing.txt")])).toBe(1);
    expect(existsSync(join(dir, ".shipvo"))).toBe(false);
  });
  it("fails cleanly on a corrupt statement file", async () => {
    const dir = setup();
    mkdirSync(join(dir, ".shipvo", "rotations"), { recursive: true });
    writeFileSync(join(dir, ".shipvo", "rotations", "1.json"), "{nope");
    expect(await run(dir, ["--root-seed-file", join(dir, "root.txt")])).toBe(1);
    expect(existsSync(join(dir, ".shipvo", "seed.next.txt"))).toBe(false);
  });
  it("--revoke-after now gives revokeOldAfter null", async () => {
    const dir = setup();
    expect(await run(dir, ["--root-seed-file", join(dir, "root.txt"), "--revoke-after", "now"])).toBe(0);
    expect(read(dir, 1).revokeOldAfter).toBeNull();
  });
  it.each(["abc", "-1", "Infinity", "1e12"])("rejects --revoke-after %s with exit 2", async (v) => {
    const dir = setup();
    expect(await run(dir, ["--root-seed-file", join(dir, "root.txt"), "--revoke-after", v])).toBe(2);
    expect(existsSync(join(dir, ".shipvo"))).toBe(false);
  });
});

describe("shipvo keys root", () => {
  const capture = async (rest: string[]) => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try { const code = await rotationCmd("root", rest); return { code, err: err.mock.calls.flat().join("\n"), out: log.mock.calls.flat().join("\n") }; }
    finally { err.mockRestore(); log.mockRestore(); }
  };
  it("writes a 32-byte seed with mode 0600 and prints the matching rootKey", async () => {
    const f = join(mkdtempSync(join(tmpdir(), "root-")), "root.txt");
    const r = await capture(["--out", f]);
    expect(r.code).toBe(0);
    const s = readFileSync(f, "utf8").trim();
    expect(Buffer.from(s, "base64").length).toBe(32);
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(r.out).toContain(pub(s));
    expect(r.out).not.toContain(s);
  });
  it("refuses to overwrite an existing file", async () => {
    const f = join(mkdtempSync(join(tmpdir(), "root-")), "root.txt");
    writeFileSync(f, "original\n");
    const r = await capture(["--out", f]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/already exists/);
    expect(readFileSync(f, "utf8")).toBe("original\n");
    expect(r.out).toBe("");
  });
  it("without --out warns on stderr and still prints the key", async () => {
    const r = await capture([]);
    expect(r.code).toBe(0);
    expect(r.err).toMatch(/Warning/);
    const seedLine = r.out.split("\n").find((l) => l.startsWith("root seed"))!;
    const s = seedLine.split(": ").pop()!.trim();
    expect(r.out).toContain(pub(s));
  });
});

describe("validFrom skew", () => {
  it("rejects a statement just past now + skew and accepts one at the edge", () => {
    const now = Date.now(), skew = 5000;
    const at = (d: number) => makeRotation(body({ validFrom: new Date(now + d).toISOString() }), root);
    expect(checkRotation(at(skew), trust, now, skew)).toBeNull();
    expect(checkRotation(at(skew + 1), trust, now, skew)).toBe("not_yet_valid");
  });
});
