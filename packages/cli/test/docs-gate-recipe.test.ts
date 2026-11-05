import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { help, COMMANDS } from "../src/help";

const doc = readFileSync(join(__dirname, "..", "..", "..", "docs", "testing.md"), "utf8");
const block = doc.split("# gate-recipe:start")[1]?.split("# gate-recipe:end")[0] ?? "";
const lines = block.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("npx shipvo "));

describe("docs/testing.md gate recipe", () => {
  it("has commands", () => expect(lines.length).toBeGreaterThanOrEqual(3));

  for (const line of lines) {
    it(`${line} uses a real subcommand and real flags`, () => {
      const words = line.replace(/[>&].*$/, "").trim().split(/\s+/).slice(2);
      const sub = words[0];
      expect(COMMANDS as readonly string[]).toContain(sub);
      const helpLines = help.split("\n").filter((l) => l.trim().startsWith(sub + " ") || l.trim() === sub);
      expect(helpLines.length).toBeGreaterThan(0);
      const text = helpLines.join("\n");
      for (const flag of words.filter((w) => w.startsWith("--"))) expect(text).toContain(flag);
    });
  }
});
