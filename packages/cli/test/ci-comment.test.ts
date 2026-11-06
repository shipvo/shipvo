import { describe, it, expect } from "vitest";
import { MARKER, changedScreens, commentCmd, renderComment, upsertComment } from "../src/ci-comment";

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
    expect(c).toContain("New crashes or runtime errors: 1");
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
