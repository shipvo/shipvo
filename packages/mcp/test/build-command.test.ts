import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// upload_build and `shipvo sim` must build the same way. The two packages cannot share code (mcp does not depend on cli), so this pins the command line in both.
const flags = (file: string, re: RegExp) => {
  const m = re.exec(readFileSync(resolve(__dirname, file), "utf8"));
  if (!m) throw new Error(`export command not found in ${file}`);
  return m[1].replace(/\s+/g, "").split(",").map((a) => a.replace(/"/g, "")).filter((a) => a !== "next" && a !== "sim-dist").join(" ");
};
describe("build command", () => {
  it("is the same in upload_build and shipvo sim", () => {
    const mcp = flags("../src/build-upload.ts", /run\("npx", \[([^\]]*)\]/);
    const cli = flags("../../cli/src/sim.ts", /spawnBin\("npx", \[([^\]]*)\]/);
    expect(mcp).toBe("expo export --platform web --clear --output-dir");
    expect(mcp).toBe(cli);
  });
});
