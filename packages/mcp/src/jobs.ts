// Job handles for slow tools. A tool starts the work, waits up to wait_ms, and returns the result or
// { status: "running", job }. job_status reads the job later. The agent never has to hold one long call open
// or start the same work twice. Jobs belong to a principal (the API key); another principal gets not-found.
import { randomUUID } from "node:crypto";

export type JobError = { code: string; error: string };
export type JobView<T> =
  | { status: "running"; job: string }
  | { status: "done"; job: string; result: T }
  | { status: "failed"; job: string; error: JobError };

type Job<T> = { id: string; principal: string; key: string; state: JobView<T>; settled: Promise<void>; expires: number };

export const DEFAULT_WAIT_MS = 20_000;
export const MAX_WAIT_MS = 55_000;
const clampWait = (ms: number | undefined) => Math.max(0, Math.min(MAX_WAIT_MS, Number.isFinite(ms) ? (ms as number) : DEFAULT_WAIT_MS));

export class JobStore<T = unknown> {
  private jobs = new Map<string, Job<T>>();
  constructor(private ttlMs = 15 * 60_000, private now: () => number = Date.now) {}

  private sweep() { for (const [id, j] of this.jobs) if (j.expires <= this.now()) this.jobs.delete(id); }

  private async wait(j: Job<T>, waitMs: number): Promise<JobView<T>> {
    if (j.state.status === "running" && waitMs > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([j.settled, new Promise<void>((r) => { timer = setTimeout(r, waitMs); })]);
      clearTimeout(timer);
    }
    return j.state;
  }

  /** Start work for a principal, or join the running job with the same key. Then wait up to waitMs. */
  async start(principal: string, key: string, work: () => Promise<T>, waitMs?: number): Promise<JobView<T>> {
    this.sweep();
    let j = [...this.jobs.values()].find((x) => x.principal === principal && x.key === key && x.state.status === "running");
    if (!j) {
      const id = `job_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const job: Job<T> = { id, principal, key, state: { status: "running", job: id }, settled: Promise.resolve(), expires: this.now() + this.ttlMs };
      job.settled = work().then(
        (result) => { job.state = { status: "done", job: id, result }; },
        (e) => { const c = (e as { code?: unknown })?.code; job.state = { status: "failed", job: id, error: { code: typeof c === "string" ? c : "job_failed", error: (e as Error)?.message ?? String(e) } }; },
      ).then(() => { job.expires = this.now() + this.ttlMs; });
      this.jobs.set(id, job);
      j = job;
    }
    return this.wait(j, clampWait(waitMs));
  }

  /** Read a job. Returns undefined for an unknown, expired or foreign job id. */
  async status(principal: string, id: string, waitMs?: number): Promise<JobView<T> | undefined> {
    this.sweep();
    const j = this.jobs.get(id);
    if (!j || j.principal !== principal) return undefined;
    return this.wait(j, clampWait(waitMs));
  }
}
