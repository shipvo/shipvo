import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pairShots } from "../src/ci-shots";
import { describe, it, expect } from "vitest";
import { MARKER, changedScreens, commentCmd, renderComment, upsertComment, uploadShots } from "../src/ci-comment";

const ok = { name: "login.steps", status: "passed" };
const bad = { name: "checkout.steps", status: "failed", message: "could not find \"Pay\"" };
const explore = (findings: any[]) => ({ app: "a", generatedAt: "", steps: 12, screens: 3, maxSteps: 50, maxDepth: 4, stoppedEarly: null, error: null, findings, parityLimits: [] }) as any;

describe("renderComment", () => {
  it("all pass", () => {
    const c = renderComment({ test: { flows: [ok] }, explore: explore([]) });
    expect(c.startsWith(MARKER)).toBe(true);
    expect(c).toContain("Shipvo check: passed");
    expect(c).toContain("| login.steps | ✅ passed |");
    expect(c).toContain("No findings in 12 steps");
  });
  it("one failure", () => {
    const c = renderComment({ test: { flows: [ok, bad] }, explore: explore([]) });
    expect(c).toContain("Shipvo check: failed");
    expect(c).toContain("❌ failed: could not find");
    expect(c).toContain("✅ passed");
  });
  it("a regression: new crash, dead end and screenshots capped at 4", () => {
    const c = renderComment({
      test: { flows: [ok] },
      explore: explore([{ kind: "error", message: "TypeError", screen: "cart", steps: [] }, { kind: "dead_end", message: "no way out", screen: "help", steps: [] }]),
      changed: ["cart"], screenshots: ["a.png", "b.png", "c.png", "d.png", "e.png"], runUrl: "https://github.com/o/r/actions/runs/1",
    });
    expect(c).toContain("Shipvo check: failed");
    expect(c).toContain("Crashes or runtime errors: 1");
    expect(c).toContain("Dead ends: 1");
    expect(c).toContain("4 screenshots saved");
    expect(c).not.toContain("e.png");
    expect(c).toContain("[this run](https://github.com/o/r/actions/runs/1)");
  });
});

describe("changed screens without screenshots", () => {
  it("lists the changed screens and says none were captured", () => {
    const c = renderComment({ test: { flows: [ok] }, changed: ["cart", "home"] });
    expect(c).toContain("### Changed screens");
    expect(c).toContain("`cart`, `home`");
    expect(c).toContain("No screenshots were captured");
  });
  it("has no section when nothing changed", () => {
    expect(renderComment({ test: { flows: [ok] } })).not.toContain("Changed screens");
  });
});

describe("commentCmd", () => {
  it("returns 0 and prints the body when there is no token", async () => {
    const saved = { ...process.env };
    delete process.env.GITHUB_TOKEN;
    const out: string[] = [];
    const log = console.log, err = console.error;
    console.log = (m: string) => { out.push(String(m)); }; console.error = () => {};
    try { expect(await commentCmd(["--pr", "3"])).toBe(0); } finally { console.log = log; console.error = err; process.env = saved; }
    expect(out.join("\n")).toContain(MARKER);
  });

  it("names the missing values and still renders when the diff cannot be read", async () => {
    const saved = { ...process.env };
    delete process.env.GITHUB_TOKEN; delete process.env.GITHUB_REPOSITORY;
    const out: string[] = [], errs: string[] = [];
    const log = console.log, err = console.error;
    console.log = (m: string) => { out.push(String(m)); }; console.error = (m: string) => { errs.push(String(m)); };
    try { expect(await commentCmd(["--changed-from", "0000000000000000000000000000000000000000"])).toBe(0); } finally { console.log = log; console.error = err; process.env = saved; }
    expect(errs.join("\n")).toContain("could not read the diff");
    expect(errs.join("\n")).toContain("missing GITHUB_TOKEN, GITHUB_REPOSITORY");
    expect(out.join("\n")).toContain(MARKER);
  });
});

describe("upsertComment", () => {
  it("does not overwrite a human comment that quotes the marker", async () => {
    const calls: string[] = [];
    const fetch = async (url: string, init: any = {}) => {
      const m = init.method ?? "GET"; calls.push(m);
      if (m === "GET") return { ok: true, status: 200, json: async () => [{ id: 1, body: `quote ${MARKER}`, user: { type: "User" } }, { id: 2, body: `${MARKER}\nold`, user: { type: "Bot" } }] };
      return { ok: true, status: 200, json: async () => ({}) };
    };
    expect(await upsertComment({ repo: "o/r", pr: 3, token: "t", body: `${MARKER}\nnew`, fetch })).toBe("updated");
    expect(calls).toEqual(["GET", "PATCH"]);
  });
  it("explains a 403", async () => {
    const fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
    await expect(upsertComment({ repo: "o/r", pr: 3, token: "t", body: MARKER, fetch })).rejects.toThrow(/read-only/);
  });
  it("the second run updates the first comment", async () => {
    const store: { id: number; body: string }[] = [{ id: 7, body: "someone else" }];
    const calls: string[] = [];
    const fetch = async (url: string, init: any = {}) => {
      const m = init.method ?? "GET"; calls.push(`${m} ${url.replace("https://api.github.com/repos/o/r", "")}`);
      if (m === "GET") return { ok: true, status: 200, json: async () => store };
      if (m === "POST") { store.push({ id: 8, body: JSON.parse(init.body).body }); return { ok: true, status: 201, json: async () => ({}) }; }
      store.find((c) => url.endsWith(`/${c.id}`))!.body = JSON.parse(init.body).body; return { ok: true, status: 200, json: async () => ({}) };
    };
    const o = { repo: "o/r", pr: 3, token: "t", fetch };
    expect(await upsertComment({ ...o, body: `${MARKER}\nfirst` })).toBe("created");
    expect(await upsertComment({ ...o, body: `${MARKER}\nsecond` })).toBe("updated");
    expect(store.map((c) => c.body)).toEqual(["someone else", `${MARKER}\nsecond`]);
    expect(calls.filter((c) => c.startsWith("POST"))).toHaveLength(1);
  });
});

describe("changedScreens", () => {
  it("picks screens from a sample diff", () => {
    const diff = ["app/index.tsx", "app/cart/index.tsx", "app/profile.tsx", "app/_layout.tsx", "app/profile.test.tsx", "src/screens/Settings.tsx", "README.md", "package.json", "app/cart/index.tsx"];
    expect(changedScreens(diff)).toEqual(["home", "cart", "profile", "Settings"]);
  });
});

describe("before and after screens", () => {
  const dirs = () => {
    const root = mkdtempSync(join(tmpdir(), "pairs-"));
    for (const side of ["before", "after"]) for (const skin of ["android", "ios"]) {
      mkdirSync(join(root, side, skin), { recursive: true });
      for (const s of ["home", "cart", "a", "b", "c"]) writeFileSync(join(root, side, skin, `${s}.png`), s === "cart" ? `${side}${skin}` : s + skin);
    }
    return { before: join(root, "before"), after: join(root, "after") };
  };
  const server = (priv: boolean, store: Map<string, string> = new Map(), opts: { noBranch?: boolean; postStatus?: number; mainSha?: string | null; refStatus?: number } = {}) => {
    const calls: string[] = [];
    const posted: any[] = [];
    const fetch = async (url: string, init: any = {}) => {
      const m = init.method ?? "GET"; calls.push(`${m} ${url}`);
      const ok = (j: any, status = 200) => ({ ok: true, status, json: async () => j });
      if (url.endsWith("/repos/o/r")) return ok({ private: priv, default_branch: "main" });
      if (url.includes("/git/ref/heads/shipvo-media")) {
        if (opts.refStatus) return { ok: false, status: opts.refStatus, json: async () => ({}) };
        return opts.noBranch ? { ok: false, status: 404, json: async () => ({}) } : ok({});
      }
      if (url.endsWith("/git/ref/heads/main")) return ok(opts.mainSha === null ? {} : { object: { sha: opts.mainSha ?? "abc123" } });
      if (m === "POST" && url.endsWith("/git/refs")) { posted.push(JSON.parse(init.body)); return opts.postStatus ? { ok: false, status: opts.postStatus, json: async () => ({}) } : ok({}, 201); }
      if (m === "PUT") {
        if (store.has(url)) return { ok: false, status: 422, json: async () => ({}) };
        store.set(url, JSON.parse(init.body).content); return ok({}, 201);
      }
      return ok({ content: store.get(url.split("?")[0]) });
    };
    return { fetch, calls, posted };
  };

  it("shows one changed screen of five with both skins and different image URLs", async () => {
    const d = dirs();
    const { pairs, moreCount } = pairShots(d.before, d.after);
    const s = server(false);
    const images = await uploadShots({ repo: "o/r", token: "t", key: "pr-3/abc", pairs, beforeDir: d.before, afterDir: d.after, fetch: s.fetch });
    const c = renderComment({ pairs, moreCount, images });
    expect(c).toContain("**cart**");
    expect(c).toContain("| Android |");
    expect(c).toContain("| iOS |");
    const imgs = [...c.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(imgs).size).toBe(imgs.length);
    expect(images!["before/android/cart.png"]).not.toBe(images!["after/android/cart.png"]);
    expect(images!["before/android/cart.png"]).toContain("/before/");
    expect(c).toContain('alt="cart Android, before"');
    expect(c).toContain('alt="cart iOS, after"');
  });
  it("creates the media branch from the default branch when the ref answers 404", async () => {
    const d = dirs();
    const { pairs } = pairShots(d.before, d.after);
    const s = server(false, new Map(), { noBranch: true, mainSha: "deadbeef" });
    const images = await uploadShots({ repo: "o/r", token: "t", key: "k", pairs, beforeDir: d.before, afterDir: d.after, fetch: s.fetch });
    expect(s.posted).toEqual([{ ref: "refs/heads/shipvo-media", sha: "deadbeef" }]);
    expect(images).not.toBeNull();
    expect(s.calls.findIndex((x) => x.startsWith("POST"))).toBeLessThan(s.calls.findIndex((x) => x.startsWith("PUT")));
  });
  it("a failed branch creation names contents: write and the comment lists file names", async () => {
    const d = dirs();
    const { pairs, moreCount } = pairShots(d.before, d.after);
    const s = server(false, new Map(), { noBranch: true, postStatus: 403 });
    await expect(uploadShots({ repo: "o/r", token: "t", key: "k", pairs, beforeDir: d.before, afterDir: d.after, fetch: s.fetch })).rejects.toThrow(/contents: write/);
    expect(s.calls.some((x) => x.startsWith("PUT"))).toBe(false);
    const c = renderComment({ pairs, moreCount, images: null });
    expect(c).toContain("`android/cart.png`");
  });
  it("throws a clear error when the default branch sha is missing", async () => {
    const d = dirs();
    const { pairs } = pairShots(d.before, d.after);
    const s = server(false, new Map(), { noBranch: true, mainSha: null });
    await expect(uploadShots({ repo: "o/r", token: "t", key: "k", pairs, beforeDir: d.before, afterDir: d.after, fetch: s.fetch })).rejects.toThrow(/could not read the main branch/);
    expect(s.posted).toEqual([]);
  });
  it("a non-404 failure on the media branch lookup stops the upload", async () => {
    const d = dirs();
    const { pairs } = pairShots(d.before, d.after);
    const s = server(false, new Map(), { refStatus: 500 });
    await expect(uploadShots({ repo: "o/r", token: "t", key: "k", pairs, beforeDir: d.before, afterDir: d.after, fetch: s.fetch })).rejects.toThrow(/\(500\)/);
    expect(s.calls.some((x) => x.startsWith("PUT"))).toBe(false);
  });
  it("a private repo uploads nothing and lists the files", async () => {
    const d = dirs();
    const { pairs, moreCount } = pairShots(d.before, d.after);
    const s = server(true);
    const images = await uploadShots({ repo: "o/r", token: "t", key: "k", pairs, beforeDir: d.before, afterDir: d.after, fetch: s.fetch });
    expect(images).toBeNull();
    expect(s.calls.some((x) => x.startsWith("PUT"))).toBe(false);
    const c = renderComment({ pairs, moreCount, images });
    expect(c).not.toContain("<img");
    expect(c).toContain("- Android: before `android/cart.png`, after `android/cart.png`");
  });
  it("an existing file with the same bytes is success; different bytes is not", async () => {
    const d = dirs();
    const { pairs } = pairShots(d.before, d.after);
    const store = new Map<string, string>();
    const s = server(false, store);
    const o = { repo: "o/r", token: "t", key: "k", pairs, beforeDir: d.before, afterDir: d.after, fetch: s.fetch };
    await uploadShots(o);
    expect(await uploadShots(o)).not.toBeNull();
    const first = [...store.keys()].find((k) => k.includes("/before/android/cart.png"))!;
    store.set(first, Buffer.from("other").toString("base64"));
    await expect(uploadShots(o)).rejects.toThrow(/different content/);
  });
});
