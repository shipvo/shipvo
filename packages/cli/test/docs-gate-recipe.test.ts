import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { help, COMMANDS } from "../src/help";

const here = dirname(fileURLToPath(import.meta.url));
const doc = readFileSync(join(here, "..", "..", "..", "docs", "testing.md"), "utf8");
const block = doc.split("# gate-recipe:start")[1]?.split("# gate-recipe:end")[0] ?? "";
const lines = block.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("npx shipvo "));

// Every help entry for a subcommand: its own lines plus indented continuation lines.
function entries(sub: string): string {
  const out: string[] = [];
  let on = false;
  for (const l of help.split("\n")) {
    const t = l.trim();
    if (/^\s{2}\S/.test(l)) on = t === sub || t.startsWith(sub + " ");
    else if (!/^\s{3,}\S/.test(l)) on = false;
    if (on) out.push(t);
  }
  return out.join("\n");
}

const flagTokens = (text: string) => new Set(text.match(/--[a-z][a-z-]*/g) ?? []);

export function checkLine(line: string): string[] {
  const words = line.replace(/[>&].*$/, "").trim().split(/\s+/).slice(2);
  const sub = words[0];
  if (!(COMMANDS as readonly string[]).includes(sub)) return [`unknown subcommand ${sub}`];
  const known = flagTokens(entries(sub));
  if (!known.size && !entries(sub)) return [`no help entry for ${sub}`];
  return words.filter((w) => w.startsWith("--") && !known.has(w)).map((w) => `unknown flag ${w}`);
}

describe("docs/testing.md gate recipe", () => {
  it("has commands", () => expect(lines.length).toBeGreaterThanOrEqual(4));

  for (const line of lines) {
    it(`${line} uses a real subcommand and real flags`, () => expect(checkLine(line)).toEqual([]));
  }

  it("catches a fake flag and a flag that only prefixes a real one", () => {
    expect(checkLine("npx shipvo test --made-up")).toEqual(["unknown flag --made-up"]);
    expect(checkLine("npx shipvo promote --repo")).toEqual(["unknown flag --repo"]);
    expect(checkLine("npx shipvo test --reporter x")).toEqual(["unknown flag --reporter"]);
  });
});
