import { describe, it, expect } from "vitest";
import { checkBundle, hermesBytecodeVersion, parseDeclared } from "../src/hermes";

/** A tiny fake .hbc: the 8-byte magic, a little-endian u32 version, then some padding. */
const fakeHbc = (version: number) => {
  const b = new Uint8Array(32);
  b.set([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f], 0);
  new DataView(b.buffer).setUint32(8, version, true);
  return b;
};

describe("hermes bytecode header", () => {
  it("extracts the version", () => {
    expect(hermesBytecodeVersion(fakeHbc(96))).toBe(96);
    expect(hermesBytecodeVersion(fakeHbc(300))).toBe(300);
  });
  it("returns null for plain JavaScript and short input", () => {
    expect(hermesBytecodeVersion(new TextEncoder().encode("var a = 1; // not bytecode"))).toBeNull();
    expect(hermesBytecodeVersion(new Uint8Array(4))).toBeNull();
  });
});

describe("publish check", () => {
  it("records the version when nothing is declared", () => expect(checkBundle("a.hbc", fakeHbc(96))).toBe(96));
  it("accepts a version in the declared range", () => expect(checkBundle("a.hbc", fakeHbc(98), [96, 98])).toBe(98));
  it("fails when the version is not declared by the shell", () =>
    expect(() => checkBundle("a.hbc", fakeHbc(99), [98])).toThrow(/version 99.*run 98/));
  it("fails on plain .js when bytecode is expected", () =>
    expect(() => checkBundle("a.js", new TextEncoder().encode("var a=1;"), [98])).toThrow(/plain JavaScript/));
  it("fails on a .hbc file without a header", () =>
    expect(() => checkBundle("a.hbc", new Uint8Array(32))).toThrow(/no Hermes bytecode header/));
  it("keeps working for plain .js when nothing is declared", () =>
    expect(checkBundle("a.js", new TextEncoder().encode("var a=1;"))).toBeUndefined());
});

describe("declared versions", () => {
  it("parses flags and config values", () => {
    expect(parseDeclared("96,98")).toEqual([96, 98]);
    expect(parseDeclared(96)).toEqual([96]);
    expect(parseDeclared(undefined)).toBeUndefined();
    expect(() => parseDeclared("abc")).toThrow();
  });
});
