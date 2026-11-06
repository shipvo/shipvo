// The JSON envelope every `--json` command prints: one document on stdout, progress on stderr.
export type Next = { command: string; why: string };
export type Envelope<C extends string = string, D = unknown> = {
  ok: boolean;
  /** Short stable string. */
  code: C;
  summary: string;
  data: D;
  /** One to three commands to run next, most urgent first. */
  next: Next[];
};

/** Exit codes shared by the `--json` commands. */
export const EXIT = { ok: 0, failed: 1, usage: 2 } as const;

/** Print the envelope as one line on stdout. */
export function emit(doc: Envelope<string, unknown>): void {
  console.log(JSON.stringify(doc));
}

/** Build an envelope. `ok` is true exactly when the exit code is 0. */
export function envelope<C extends string, D>(code: C, summary: string, data: D, next: Next[], exit: number): Envelope<C, D> {
  return { ok: exit === 0, code, summary, data, next: next.slice(0, 3) };
}
