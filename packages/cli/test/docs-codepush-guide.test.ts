import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { help, COMMANDS } from "../src/help";
import { INIT_HELP } from "../src/init";

const here = dirname(fileURLToPath(import.meta.url));
const doc = readFileSync(join(here, "..", "..", "..", "docs", "migrate-from-codepush.md"), "utf8");

// Commands from fenced bash blocks that run the shipvo CLI.
const commands = [...doc.matchAll(/```bash\n([\s\S]*?)```/g)]
  .flatMap((m) => m[1].split("\n"))
  .map((l) => l.replace(/\s+#.*$/, "").trim())
  .filter((l) => /^(npx\s+(-y\s+)?(shipvo|@shipvo\/cli)|shipvo)\s/.test(l));

// Help entry for a subcommand: its own line plus indented continuation lines.
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

export function checkLine(line: string): string[] {
  const words = line.split(/\s+/).filter((w) => w !== "-y");
  const sub = words[words[0] === "npx" ? 2 : 1];
  const rest = words.slice(words[0] === "npx" ? 3 : 2);
  if (!(COMMANDS as readonly string[]).includes(sub)) return [`unknown subcommand ${sub}`];
  // `shipvo init --help` lists the init flags; the main help only has the first line.
  const text = entries(sub) + (sub === "init" ? "\n" + INIT_HELP : "");
  if (!text) return [`no help entry for ${sub}`];
  const known = new Set(text.match(/--[a-z][a-z-]*/g) ?? []);
  return rest.filter((w) => w.startsWith("--") && !known.has(w)).map((w) => `unknown flag ${w}`);
}

describe("docs/migrate-from-codepush.md commands", () => {
  it("has shipvo commands", () => expect(commands.length).toBeGreaterThanOrEqual(5));

  for (const line of commands) {
    it(`${line} uses a real subcommand and real flags`, () => expect(checkLine(line)).toEqual([]));
  }

  it("catches a fake subcommand and a fake flag", () => {
    expect(checkLine("npx shipvo nope")).toEqual(["unknown subcommand nope"]);
    expect(checkLine("npx shipvo publish --made-up")).toEqual(["unknown flag --made-up"]);
  });
});
