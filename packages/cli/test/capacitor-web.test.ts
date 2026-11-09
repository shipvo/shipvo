import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capacitorWebDir, copyCapacitorWeb, isCapacitorWeb } from "../src/capacitor-web.js";

function project(config: string, extra: Record<string, string> = {}) {
  const d = mkdtempSync(join(tmpdir(), "cap-web-"));
  writeFileSync(join(d, "capacitor.config.ts"), config);
  mkdirSync(join(d, "android"));
  for (const [f, body] of Object.entries(extra)) { mkdirSync(join(d, f, ".."), { recursive: true }); writeFileSync(join(d, f), body); }
  return d;
}

describe("capacitor web directory", () => {
  it("reads webDir from the config and defaults to www", () => {
    expect(capacitorWebDir(project(`export default { webDir: "dist/web" };`))).toMatch(/dist[\\/]web$/);
    expect(capacitorWebDir(project(`export default { appId: "x" };`))).toMatch(/www$/);
  });
  it("refuses a webDir outside the project", () => {
    expect(() => capacitorWebDir(project(`export default { webDir: "../../etc" };`))).toThrow(/outside/);
  });
  it("copies the built directory and says so when it is not built", () => {
    const d = project(`export default { webDir: "www" };`, { "www/index.html": "<h1>hi</h1>", "www/a/b.js": "1" });
    expect(isCapacitorWeb(d)).toBe(true);
    const out = join(d, "out");
    copyCapacitorWeb(d, out);
    expect(readFileSync(join(out, "index.html"), "utf8")).toBe("<h1>hi</h1>");
    expect(existsSync(join(out, "a/b.js"))).toBe(true);
    expect(() => copyCapacitorWeb(project(`export default {};`), join(d, "o2"))).toThrow(/No index.html/);
  });
  it("leaves Expo apps alone", () => {
    expect(isCapacitorWeb(project(`export default {};`, { "app.json": "{}" }))).toBe(false);
  });
});
