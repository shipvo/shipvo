import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capacitorWeb } from "../src/capacitor-web";

const dir = () => mkdtempSync(join(tmpdir(), "cap-"));

describe("capacitorWeb", () => {
  it("reads webDir and appId from capacitor.config.ts", () => {
    const d = dir();
    writeFileSync(join(d, "capacitor.config.ts"), `const config = { appId: "dev.x.app", appName: "X", webDir: "www" };`);
    expect(capacitorWeb(d)).toEqual({ appId: "dev.x.app", webDir: join(d, "www") });
  });
  it("reads capacitor.config.json", () => {
    const d = dir();
    writeFileSync(join(d, "capacitor.config.json"), JSON.stringify({ appId: "a.b", webDir: "dist/web" }));
    expect(capacitorWeb(d)?.webDir).toBe(join(d, "dist", "web"));
  });
  it("is undefined for a folder without a Capacitor config, or a webDir outside the project", () => {
    const d = dir();
    expect(capacitorWeb(d)).toBeUndefined();
    writeFileSync(join(d, "capacitor.config.json"), JSON.stringify({ appId: "a.b", webDir: "../elsewhere" }));
    expect(capacitorWeb(d)).toBeUndefined();
  });
});
