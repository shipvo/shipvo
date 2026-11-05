import { describe, it, expect } from "vitest";
import { decideOffer } from "../src/offer";

const body = (extra: Record<string, unknown> = {}) => ({ release: 7, ...extra }) as any;
const halt = (release: unknown) => JSON.stringify({ release, halted_at: "2026-01-01T00:00:00Z" });

describe("decideOffer: hbc", () => {
  it("offers without ?hbc= or without a pointer version", () => {
    expect(decideOffer({ body: body({ hermes_bytecode_version: 96 }) })).toEqual({ ok: true, release: 7 });
    expect(decideOffer({ body: body(), hbc: "98" })).toEqual({ ok: true, release: 7 });
  });
  it("offers on a match", () => {
    expect(decideOffer({ body: body({ hermes_bytecode_version: 96 }), hbc: "95,96" }).ok).toBe(true);
  });
  it("404 on mismatch", () => {
    expect(decideOffer({ body: body({ hermes_bytecode_version: 96 }), hbc: "98" })).toEqual({ ok: false, status: 404, error: "hermes_bytecode_mismatch" });
  });
  it("400 on bad input", () => {
    for (const hbc of ["", "x", "0,-1,1.5"]) {
      expect(decideOffer({ body: body({ hermes_bytecode_version: 96 }), hbc })).toEqual({ ok: false, status: 400, error: "bad_request" });
    }
  });
});

describe("decideOffer: nm", () => {
  const required = { "@scope/pkg": "^1.2.0" };
  it("offers without ?nm= or without required modules", () => {
    expect(decideOffer({ body: body({ required_native_modules: required }) }).ok).toBe(true);
    expect(decideOffer({ body: body(), nm: "x@1.0.0" }).ok).toBe(true);
  });
  it("offers when the shell satisfies the requirement", () => {
    expect(decideOffer({ body: body({ required_native_modules: required }), nm: "@scope/pkg@1.2.3" }).ok).toBe(true);
  });
  it("404 with details on mismatch", () => {
    const r = decideOffer({ body: body({ required_native_modules: required }), nm: "other@1.0.0" });
    expect(r).toMatchObject({ ok: false, status: 404, module: "@scope/pkg", required: "^1.2.0" });
  });
  it("400 on a malformed item", () => {
    expect(decideOffer({ body: body({ required_native_modules: required }), nm: "nover" })).toEqual({ ok: false, status: 400, error: "bad_request" });
    expect(decideOffer({ body: body({ required_native_modules: required }), nm: "@only" })).toMatchObject({ status: 400 });
  });
});

describe("decideOffer: halt", () => {
  it("offers with no halt", () => {
    expect(decideOffer({ body: body(), haltedRelease: null })).toEqual({ ok: true, release: 7 });
  });
  it("404 when this release is halted", () => {
    expect(decideOffer({ body: body(), haltedRelease: halt(7) })).toEqual({ ok: false, status: 404, error: "release_halted", release: 7 });
  });
  it("ignores a halt for another release", () => {
    expect(decideOffer({ body: body(), haltedRelease: halt(6) }).ok).toBe(true);
  });
  it("ignores a corrupt halt", () => {
    for (const h of ["{not json", "null", "[]"]) expect(decideOffer({ body: body(), haltedRelease: h }).ok).toBe(true);
  });
  it("checks hbc before halt", () => {
    expect(decideOffer({ body: body({ hermes_bytecode_version: 96 }), hbc: "98", haltedRelease: halt(7) })).toMatchObject({ error: "hermes_bytecode_mismatch" });
  });
});
