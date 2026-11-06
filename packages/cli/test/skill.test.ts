import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { COMMANDS, help } from "../src/help";

const dir = resolve(__dirname, "../../../skills/shipvo");

function files(): string[] {
  const ref = join(dir, "references");
  return [join(dir, "SKILL.md"), ...(existsSync(ref) ? readdirSync(ref).map((f) => join(ref, f)) : [])];
}

/** Every `shipvo <command> [subcommand]` the skill names (code spans and code blocks). */
function named(text: string): { cmd: string; sub?: string }[] {
  const out: { cmd: string; sub?: string }[] = [];
  const re = /(?:^|[\s`(:])(?:npx -y @shipvo\/cli|shipvo)\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?/gm;
  for (const line of text.split("\n")) {
    if (!line.includes("`") && !/^\s*(shipvo|npx)/.test(line)) continue;
    for (const m of line.matchAll(re)) out.push({ cmd: m[1], sub: m[2] });
  }
  return out;
}

describe("skills/shipvo", () => {
  it("has the frontmatter the skills CLI needs", () => {
    const t = readFileSync(join(dir, "SKILL.md"), "utf8");
    expect(t).toMatch(/^---\nname: shipvo\ndescription: .+\n---/);
  });

  it("names only commands that exist in `shipvo help`", () => {
    const planned = new Set(["agents", "smoke"]);
    const list = files().flatMap((f) => named(readFileSync(f, "utf8")));
    expect(list.length).toBeGreaterThan(10);
    for (const { cmd, sub } of list) {
      if (planned.has(cmd)) continue;
      expect(COMMANDS as readonly string[], `shipvo ${cmd}`).toContain(cmd);
      expect(help, `shipvo ${cmd} in help`).toMatch(new RegExp(`^\\s+${cmd}\\b`, "m"));
      if (sub && ["store", "app", "eas", "ci", "keys"].includes(cmd)) {
        expect(help, `shipvo ${cmd} ${sub} in help`).toContain(`${cmd} ${sub}`);
      }
    }
  });
});
