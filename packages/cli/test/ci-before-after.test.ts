import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pairShots, beforeAfterSection, ensureMediaBranch, uploadShot } from "../src/ci-before-after";
import { renderComment, upsertComment, commentCmd, MARKER } from "../src/ci-comment";
import { shotsCmd } from "../src/ci-shots";

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

const res = (status: number, body: unknown = {}) => ({ ok: status < 300, status, json: async () => body });

describe("media branch and upload", () => {
  it("creates the branch as an orphan: a new tree and a commit with no parent", async () => {
    const calls: { method?: string; url: string; body?: any }[] = [];
    const fetch = async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ method: init?.method, url: url.split("/git/")[1], body: init?.body ? JSON.parse(init.body) : undefined });
      return res(init?.method === "GET" ? 404 : 201, { sha: "abc" });
    };
    await ensureMediaBranch({ repo: "o/r", token: "t", fetch });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET ref/heads/shipvo-check-media", "POST trees", "POST commits", "POST refs"]);
    expect(calls[2].body.parents).toEqual([]);
    expect(calls[3].body).toEqual({ ref: "refs/heads/shipvo-check-media", sha: "abc" });
  });
  it("does nothing when the branch exists", async () => {
    const calls: string[] = [];
    await ensureMediaBranch({ repo: "o/r", token: "t", fetch: async (u) => { calls.push(u); return res(200); } });
    expect(calls).toHaveLength(1);
  });
  it("accepts a 422 for a file that exists, rejects other 422 errors", async () => {
    const { a } = fixture();
    const file = join(a, "home.ios.png");
    const base = { repo: "o/r", token: "t", sha: "0123456789abcdef", pr: 1, side: "after", name: "home.ios.png", file };
    expect(await uploadShot({ ...base, fetch: async () => res(422, { message: "Invalid request.\n\n\"sha\" wasn't supplied." }) })).toContain("/pr-1/0123456789ab/after/home.ios.png");
    await expect(uploadShot({ ...base, fetch: async () => res(422, { message: "Branch not found" }) })).rejects.toThrow(/422: Branch not found/);
  });
});

describe("uploadShot retry", () => {
  it("retries a 409 and then succeeds", async () => {
    const { a } = fixture();
    const file = join(a, "home.ios.png");
    let n = 0;
    const url = await uploadShot({ repo: "o/r", token: "t", sha: "0123456789abcdef", pr: 1, side: "after", name: "home.ios.png", file, fetch: async () => (++n === 1 ? res(409, { message: "conflict" }) : res(201)) });
    expect(n).toBe(2);
    expect(url).toContain("/after/home.ios.png");
  });
});

describe("pairShots total", () => {
  it("does not count identical shot screens in the more-changed count", () => {
    const root = mkdtempSync(join(tmpdir(), "ba-"));
    const b = join(root, "b"), a = join(root, "a");
    mkdirSync(b); mkdirSync(a);
    const names = "abcdefgh".split("");
    for (const [i, n] of names.slice(0, 6).entries()) for (const skin of ["android", "ios"]) { writeFileSync(join(b, `${n}.${skin}.png`), "1"); writeFileSync(join(a, `${n}.${skin}.png`), i < 2 ? "1" : "2"); }
    const r = pairShots(names, b, a, (f) => f);
    expect(r.screens).toHaveLength(4);
    expect(r.total).toBe(6);
  });
  it("counts changed screens that were not shot", () => {
    const root = mkdtempSync(join(tmpdir(), "ba-"));
    const b = join(root, "b"), a = join(root, "a");
    mkdirSync(b); mkdirSync(a);
    const names = "abcdefgh".split("");
    for (const n of names.slice(0, 6)) for (const skin of ["android", "ios"]) { writeFileSync(join(b, `${n}.${skin}.png`), "1"); writeFileSync(join(a, `${n}.${skin}.png`), "2"); }
    const r = pairShots(names, b, a, (f) => f);
    expect(r.screens).toHaveLength(6);
    expect(r.total).toBe(8);
  });
});

describe("commentCmd with uploads", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; vi.restoreAllMocks(); });

  function setup() {
    const root = mkdtempSync(join(tmpdir(), "ba-"));
    const dir = join(root, "shots");
    const b = join(dir, "before"), a = join(dir, "after");
    mkdirSync(b, { recursive: true }); mkdirSync(a, { recursive: true });
    for (const skin of ["android", "ios"]) {
      writeFileSync(join(b, `home.${skin}.png`), "old"); writeFileSync(join(a, `home.${skin}.png`), "new");
      writeFileSync(join(b, `same.${skin}.png`), "x"); writeFileSync(join(a, `same.${skin}.png`), "x");
    }
    writeFileSync(join(a, "screens.json"), JSON.stringify(["home", "same"]));
    process.env.GITHUB_TOKEN = "t"; process.env.GITHUB_REPOSITORY = "o/r"; process.env.GITHUB_SHA = "0123456789abcdef";
    return { dir, root };
  }
  const run = async (args: string[]) => {
    const out: string[] = [], errs: string[] = [];
    const log = console.log, err = console.error;
    console.log = (m: string) => { out.push(String(m)); }; console.error = (m: string) => { errs.push(String(m)); };
    try { return { rc: await commentCmd(args), out: out.join("\n"), err: errs.join("\n") }; } finally { console.log = log; console.error = err; }
  };

  it("uploads only the images it shows and puts them in the posted comment", async () => {
    const { dir } = setup();
    const puts: string[] = [];
    let posted = "";
    vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: string }) => {
      const m = init?.method ?? "GET";
      if (url.includes("/contents/")) { puts.push(url.split("/contents/")[1]); return res(201); }
      if (url.includes("/git/ref/")) return res(200);
      if (m === "GET") return res(200, []);
      posted = JSON.parse(init!.body!).body; return res(201);
    });
    const r = await run(["--pr", "3", "--screenshots", dir, "--report", join(dir, "none.json")]);
    expect(r.rc).toBe(0);
    expect(puts.sort()).toEqual(["pr-3/0123456789ab/after/home.android.png", "pr-3/0123456789ab/after/home.ios.png", "pr-3/0123456789ab/before/home.android.png", "pr-3/0123456789ab/before/home.ios.png"]);
    expect(posted).toContain("### Before and after");
    expect(posted).toContain("raw.githubusercontent.com/o/r/shipvo-check-media/pr-3/0123456789ab/after/home.ios.png");
    expect(posted).not.toContain("same");
  });

  it("leaves the section out and exits 0 when the token cannot write (403)", async () => {
    const { dir } = setup();
    let posted = "";
    vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: string }) => {
      const m = init?.method ?? "GET";
      if (url.includes("/git/ref/")) return res(404);
      if (url.includes("/git/")) return res(403);
      if (m === "GET") return res(200, []);
      posted = JSON.parse(init!.body!).body; return res(201);
    });
    const r = await run(["--pr", "3", "--screenshots", dir, "--report", join(dir, "none.json"), "--fail-on-regression"]);
    expect(r.rc).toBe(0);
    expect(r.err).toContain("Before and after images not uploaded");
    expect(posted).toContain("Shipvo check");
    expect(posted).not.toContain("Before and after");
  });
});

describe("shotsCmd screens.json", () => {
  it("writes the screen list with --skins and reads it back with --screens-file", async () => {
    const root = mkdtempSync(join(tmpdir(), "sc-"));
    writeFileSync(join(root, "shipvo.json"), JSON.stringify({ appId: "app", controlPlane: "http://x", publicKey: "k" }));
    const list = join(root, "list.json");
    writeFileSync(list, JSON.stringify(["a", "b"]));
    const cwd = process.cwd();
    const sessions: string[] = [];
    vi.stubGlobal("fetch", async (u: string, init?: { body?: string }) => { if (String(u).endsWith("/session")) sessions.push(init!.body!); return res(200, { ok: true, data: Buffer.from("png").toString("base64") }); });
    process.chdir(root);
    try {
      const out = join(root, "out");
      expect(await shotsCmd(["--skins", "android,ios", "--screens-file", list, "--out", join(root, "base")])).toBe(0);
      expect(existsSync(join(root, "base", "screens.json"))).toBe(false);
      expect(existsSync(join(root, "base", "a.ios.png"))).toBe(true);
      // Two screens, two skins: one session per skin.
      expect(sessions).toHaveLength(2);
      expect(sessions.map((x) => JSON.parse(x)).map((x) => [x.device.platform, x.width, x.height])).toEqual([["android", 390, 844], ["ios", 390, 844]]);
      // Without --screens-file the list comes from the diff and is written next to the images.
      const { execFileSync } = await import("node:child_process");
      execFileSync("git", ["init", "-q"], { cwd: root });
      execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "--allow-empty", "-m", "i"], { cwd: root });
      mkdirSync(join(root, "app")); writeFileSync(join(root, "app", "home.tsx"), "x");
      execFileSync("git", ["add", "."], { cwd: root });
      execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "-m", "s"], { cwd: root });
      expect(await shotsCmd(["--changed-from", "HEAD~1", "--skins", "android,ios", "--out", out])).toBe(0);
      expect(JSON.parse(readFileSync(join(out, "screens.json"), "utf8"))).toEqual(["home"]);
    } finally { process.chdir(cwd); vi.unstubAllGlobals(); }
  });
});
