import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ReleasePointer, SignedEnvelope } from "../src/index";

const doc = readFileSync(fileURLToPath(new URL("../../../docs/spec/release-format.md", import.meta.url)), "utf8");
const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (p: string) => readFileSync(`${root}/${p}`, "utf8");

describe("docs/spec/release-format.md", () => {
  it("names every ReleasePointer field", () => {
    for (const f of Object.keys(ReleasePointer.shape)) expect(doc, f).toContain(`\`${f}\``);
  });
  it("names every envelope field", () => {
    for (const f of Object.keys(SignedEnvelope.shape)) expect(doc, f).toContain(`\`${f}\``);
  });
  it("names every nested core field", () => {
    for (const f of Object.keys((ReleasePointer.shape.core as any).shape)) expect(doc, f).toContain(`\`${f}\``);
  });
  it("lists only typed reasons that exist in the runtime code", () => {
    const code = read("packages/runtime/android/src/main/java/dev/shipvo/runtime/PointerQuery.kt") + read("packages/runtime/ios/Updater.swift");
    const reasons = [...doc.matchAll(/^- `([a-z_]+)`$/gm)].map((m) => m[1]);
    expect(reasons.length).toBe(3);
    for (const r of reasons) expect(code, r).toContain(r);
  });
  it("lists only runtime error text that exists in the runtime code", () => {
    const code = read("packages/runtime/ios/Updater.swift") + read("packages/runtime/android/src/main/java/dev/shipvo/runtime/ShipvoRuntimeModule.kt");
    const section = doc.split("Runtime errors")[1].split("Typed reasons")[0];
    const reasons = [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
    expect(reasons.length).toBe(6);
    for (const r of reasons) expect(code, r).toContain(r);
  });
});
