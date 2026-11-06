import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pairShots, beforeAfterSection } from "../src/ci-before-after";
import { renderComment, upsertComment, MARKER } from "../src/ci-comment";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ba-"));
  const b = join(root, "before"), a = join(root, "after");
  mkdirSync(b); mkdirSync(a);
  for (const skin of ["android", "ios"]) {
    writeFileSync(join(b, `home.${skin}.png`), `old-${skin}`);
    writeFileSync(join(a, `home.${skin}.png`), `new-${skin}`);
    writeFileSync(join(b, `settings.${skin}.png`), "same");
    writeFileSync(join(a, `settings.${skin}.png`), "same");
  }
  return { b, a };
}

describe("before and after", () => {
  it("shows only the screen that changed, on both skins", () => {
    const { b, a } = fixture();
    const r = pairShots(["home", "settings"], b, a, (f, side) => `https://img/${side}/${f.split("/").pop()}`);
    expect(r.screens.map((s) => s.screen)).toEqual(["home"]);
    expect(r.screens[0].pairs.map((p) => p.skin)).toEqual(["android", "ios"]);
    const md = beforeAfterSection(r).join("\n");
    expect(md).toContain("| Android |");
    expect(md).toContain("| iOS |");
    expect(md).toContain("https://img/before/home.ios.png");
    expect(md).toContain("https://img/after/home.android.png");
    expect(md).not.toContain("settings");
  });
  it("shows six screens and links to the rest", () => {
    const root = mkdtempSync(join(tmpdir(), "ba-"));
    const b = join(root, "b"), a = join(root, "a");
    mkdirSync(b); mkdirSync(a);
    const names = "abcdefgh".split("");
    for (const n of names) for (const skin of ["android", "ios"]) { writeFileSync(join(b, `${n}.${skin}.png`), "1"); writeFileSync(join(a, `${n}.${skin}.png`), "2"); }
    const r = pairShots(names, b, a, (f) => f);
    expect(r.screens).toHaveLength(6);
    expect(r.total).toBe(8);
    expect(beforeAfterSection(r, "https://run/1").join("\n")).toContain("2 more changed screens");
  });
  it("sits in the single comment, which is updated in place on the next push", async () => {
    const { b, a } = fixture();
    const ba = pairShots(["home"], b, a, (f) => f);
    const body = renderComment({ beforeAfter: ba });
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain("### Before and after");
    const calls: string[] = [];
    const fetch = async (url: string, init?: { method?: string }) => {
      calls.push(`${init?.method} ${url.split("/repos/")[1]}`);
      return { ok: true, status: 200, json: async () => (init?.method === "GET" ? [{ id: 7, body, user: { type: "Bot" } }] : {}) };
    };
    expect(await upsertComment({ repo: "o/r", pr: 3, token: "t", body, fetch })).toBe("updated");
    expect(calls.at(-1)).toBe("PATCH o/r/issues/comments/7");
  });
});
