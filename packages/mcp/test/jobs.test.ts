import { describe, expect, it } from "vitest";
import { JobStore } from "../src/jobs.js";

const gate = () => { let open!: (v: string) => void, fail!: (e: Error) => void; const p = new Promise<string>((a, b) => { open = a; fail = b; }); return { p, open, fail }; };

describe("job handles", () => {
  it("returns running past wait_ms, then done through status", async () => {
    const s = new JobStore<string>(); const g = gate();
    const first = await s.start("a", "k", () => g.p, 20);
    expect(first.status).toBe("running");
    const job = first.job;
    expect((await s.status("a", job, 0))!.status).toBe("running");
    g.open("https://x/p");
    const done = await s.status("a", job, 1000);
    expect(done).toEqual({ status: "done", job, result: "https://x/p" });
  });

  it("long-polls: status waits for work that finishes inside wait_ms", async () => {
    const s = new JobStore<string>(); const g = gate();
    const { job } = await s.start("a", "k", () => g.p, 0);
    setTimeout(() => g.open("ok"), 30);
    expect((await s.status("a", job, 2000))!.status).toBe("done");
  });

  it("returns the same job for the same request while running, and starts new work after", async () => {
    const s = new JobStore<string>(); const g = gate(); let runs = 0;
    const work = () => { runs++; return g.p; };
    const a = await s.start("a", "k", work, 0), b = await s.start("a", "k", work, 0);
    expect(b.job).toBe(a.job); expect(runs).toBe(1);
    expect((await s.start("a", "other", work, 0)).job).not.toBe(a.job);
    g.open("x"); await s.status("a", a.job, 1000);
    expect((await s.start("a", "k", () => Promise.resolve("y"), 1000)).job).not.toBe(a.job);
  });

  it("does not show a job to another principal, nor join its running work", async () => {
    const s = new JobStore<string>(); const g = gate();
    const a = await s.start("a", "k", () => g.p, 0);
    expect(await s.status("b", a.job, 0)).toBeUndefined();
    expect((await s.start("b", "k", () => g.p, 0)).job).not.toBe(a.job);
  });

  it("reports a typed error when the work fails", async () => {
    const s = new JobStore<string>(); const g = gate();
    const { job } = await s.start("a", "k", () => g.p, 0);
    g.fail(Object.assign(new Error("build broke"), { code: "preview_failed" }));
    expect(await s.status("a", job, 1000)).toEqual({ status: "failed", job, error: { code: "preview_failed", error: "build broke" } });
    const plain = await s.start("a", "z", () => Promise.reject(new Error("boom")), 1000);
    expect(plain).toMatchObject({ status: "failed", error: { code: "job_failed" } });
  });

  it("forgets a finished job after the TTL", async () => {
    let t = 0; const s = new JobStore<string>(1000, () => t);
    const { job } = await s.start("a", "k", () => Promise.resolve("x"), 1000);
    expect((await s.status("a", job))!.status).toBe("done");
    t = 5000;
    expect(await s.status("a", job)).toBeUndefined();
  });
});
