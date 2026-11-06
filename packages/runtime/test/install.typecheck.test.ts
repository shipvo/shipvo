import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// `@shipvo/runtime` ships TypeScript source, so an app's compiler checks install.ts. It must pass under strict
// settings with the newer `Uint8Array<ArrayBufferLike>` typing.
describe("install.ts type check", () => {
  it("has no type errors under strict tsc", () => {
    const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
    const file = fileURLToPath(new URL("../src/install.ts", import.meta.url));
    let out = "";
    try {
      execFileSync(process.execPath, [tsc, "--noEmit", "--strict", "--target", "es2022", "--module", "esnext",
        "--moduleResolution", "bundler", "--lib", "es2022,dom", "--skipLibCheck", file], { encoding: "utf8" });
    } catch (e: any) { out = String(e.stdout || e.message); }
    expect(out).toBe("");
  }, 60000);
});
