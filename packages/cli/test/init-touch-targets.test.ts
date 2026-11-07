import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../src/init";

let tmp = "";
const apps: Record<string, string> = {};
beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "init-targets-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  for (const t of ["shop", "content"]) {
    const dir = join(tmp, t);
    await init([dir, "--name", "App", "--public-key", "AAAA", "--template", t]);
    const files = [join(dir, "App.tsx")];
    for (const f of readdirSync(join(dir, "src/screens"))) files.push(join(dir, "src/screens", f));
    apps[t] = files.map((f) => readFileSync(f, "utf8")).join("\n");
  }
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

for (const t of ["shop", "content"]) {
  it(`${t} template: every tappable link style is at least 48 x 48`, () => {
    const styles = [...apps[t].matchAll(/\b(back|cart|link|remove): \{([^}]*)\}/g)];
    expect(styles.length).toBeGreaterThan(0);
    for (const [, name, body] of styles) {
      expect(body, `${t}.${name}`).toMatch(/minHeight: 48/);
      expect(body, `${t}.${name}`).toMatch(/minWidth: 48/);
    }
  });
}
