// #1148: `/?skin=ios` switches the phone frame of a live run and run.json follows.
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRunServer } from "../src/run";

const render: any = ({ skin }: { skin: string }) => ({ width: 1, height: 1, outerWidth: 1, outerHeight: 1, html: `<b data-skin="${skin}"></b>`, css: "" });

describe("run skin", () => {
  it("serves the other skin and rewrites run.json, and keeps it on reload", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skin-")); const dist = join(dir, "dist"); mkdirSync(dist);
    writeFileSync(join(dist, "index.html"), "<html><head></head></html>");
    const s = await startRunServer({ dir: dist, platform: "android", name: "T", appId: "t", projectDir: dir, render });
    const get = async (q = "") => (await fetch(`http://127.0.0.1:${s.port}/${q}`)).text();
    const info = () => JSON.parse(readFileSync(join(dir, ".shipvo", "run.json"), "utf8"));
    expect(await get()).toContain('data-skin="android"');
    expect(await get("?skin=ios")).toContain('data-skin="ios"');
    expect(info().platform).toBe("ios");
    expect(await get()).toContain('data-skin="ios"');
    await s.close();
  });
});
