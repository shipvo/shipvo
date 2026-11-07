import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureScreens, pairShots, parseSkins, screenRoute, shotsCmd } from "../src/ci-shots";
import { vi } from "vitest";

describe("screenRoute", () => {
  it("maps names to routes and skips dynamic ones", () => {
    expect(screenRoute("home")).toBe("/");
    expect(screenRoute("cart/summary")).toBe("/cart/summary");
    expect(screenRoute("item/[id]")).toBeNull();
    expect(screenRoute("(tabs)/feed")).toBeNull();
    expect(screenRoute("+not-found")).toBeNull();
  });
});

describe("captureScreens", () => {
  it("writes one png per screen, at most four, and skips failures", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "shots-")), "shipvo-shots");
    const logs: string[] = [];
    const files = await captureScreens(["home", "bad", "item/[id]", "a", "b", "c", "d"], async (r) => {
      if (r === "/bad") throw new Error("boom");
      return new TextEncoder().encode(`png:${r}`);
    }, dir, (s) => logs.push(s));
    expect(readdirSync(dir).sort()).toEqual(["a.png", "b.png", "home.png"].sort());
    expect(files).toHaveLength(3);
    expect(readFileSync(join(dir, "home.png"), "utf8")).toBe("png:/");
    expect(logs[0]).toContain("bad");
  });
  it("writes nothing when no screen has a route", async () => {
    expect(await captureScreens(["x/[id]"], async () => new Uint8Array(), join(tmpdir(), "never-made-xyz"))).toEqual([]);
  });
});

describe("pairShots", () => {
  const make = (screens: string[], diff: (s: string, skin: string) => boolean) => {
    const root = mkdtempSync(join(tmpdir(), "pairs-"));
    for (const side of ["before", "after"]) for (const skin of ["android", "ios"]) {
      mkdirSync(join(root, side, skin), { recursive: true });
      for (const s of screens) writeFileSync(join(root, side, skin, `${s}.png`), side === "after" && diff(s, skin) ? "new" : "old");
    }
    return root;
  };
  it("returns one changed pair per skin when only home differs", () => {
    const root = make(["home", "cart", "feed", "profile", "settings"], (s) => s === "home");
    const { pairs } = pairShots(join(root, "before"), join(root, "after"));
    const changed = pairs.filter((p) => p.changed);
    expect(changed.map((p) => `${p.skin}:${p.screen}`).sort()).toEqual(["android:home", "ios:home"]);
    expect(changed[0]).toMatchObject({ before: expect.stringMatching(/^(android|ios)\/home\.png$/), after: expect.stringMatching(/^(android|ios)\/home\.png$/) });
    expect(pairs.slice(0, 2).every((p) => p.changed)).toBe(true);
  });
  it("gives the same result for ./dir and dir", () => {
    const root = make(["home", "cart"], (s) => s === "home");
    const cwd = process.cwd();
    process.chdir(root);
    try { expect(pairShots("./before", "./after")).toEqual(pairShots("before", "after")); } finally { process.chdir(cwd); }
  });
  it("caps at six pairs and counts the rest", () => {
    const root = make(["a", "b", "c", "d", "e", "f", "g", "h"], () => true);
    rmSync(join(root, "before", "ios"), { recursive: true }); rmSync(join(root, "after", "ios"), { recursive: true });
    const r = pairShots(join(root, "before"), join(root, "after"));
    expect(r.pairs).toHaveLength(6);
    expect(r.moreCount).toBe(2);
  });
  it("marks a missing side as changed and names the side", () => {
    const root = make(["home"], () => false);
    rmSync(join(root, "before", "ios", "home.png"));
    const p = pairShots(join(root, "before"), join(root, "after")).pairs[0];
    expect(p).toEqual({ screen: "home", skin: "ios", after: "ios/home.png", changed: true });
  });
});

describe("ci shots on both skins", () => {
  it("parses skins", () => {
    expect(parseSkins(undefined)).toEqual(["android", "ios"]);
    expect(parseSkins("ios")).toEqual(["ios"]);
    expect(parseSkins("web")).toBeNull();
  });
  const run = async (screens: string, missing: string[], out: string) => {
    const cwd = process.cwd(), app = mkdtempSync(join(tmpdir(), "app-"));
    writeFileSync(join(app, "shipvo.json"), JSON.stringify({ appId: "a", controlPlane: "http://x", publicKey: "k" }));
    const sessions: Record<string, string> = {};
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      const b = JSON.parse(init.body);
      if (url.endsWith("/session")) { sessions[b.session] = b.device.platform; return Response.json({ ok: true }); }
      if (b.action === "open_url") { sessions[b.session] += `|${b.url}`; return Response.json({ ok: !missing.includes(b.url) }); }
      const [skin, route] = sessions[b.session]!.split("|");
      return Response.json({ ok: true, data: Buffer.from(`${skin}${route}`).toString("base64") });
    });
    process.chdir(app);
    try { return await shotsCmd(["--screens", screens, "--out", out]); } finally { process.chdir(cwd); vi.unstubAllGlobals(); }
  };
  it("writes <out>/<skin>/<screen>.png for each skin", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "both-")), "after");
    expect(await run("home,cart", [], out)).toBe(0);
    expect(readdirSync(join(out, "android")).sort()).toEqual(["cart.png", "home.png"]);
    expect(readFileSync(join(out, "ios", "cart.png"), "utf8")).toBe("ios/cart");
  });
  it("gives one pair per skin for the changed screen only, and after-only for a screen the base lacks", async () => {
    const root = mkdtempSync(join(tmpdir(), "fx-"));
    await run("home,cart", ["/cart"], join(root, "before"));
    await run("home,cart", [], join(root, "after"));
    for (const skin of ["android", "ios"]) writeFileSync(join(root, "after", skin, "home.png"), "changed");
    const { pairs } = pairShots(join(root, "before"), join(root, "after"));
    expect(pairs.filter((p) => p.changed).map((p) => `${p.skin}:${p.screen}:${p.before ? "b" : "-"}${p.after ? "a" : "-"}`).sort())
      .toEqual(["android:cart:-a", "android:home:ba", "ios:cart:-a", "ios:home:ba"]);
  });
});
