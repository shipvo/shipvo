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

/** A failure with a stable code, an exit code and a suggested follow-up. Without `--json` it is a plain error. */
export class CliFailure extends Error {
  constructor(message: string, readonly code = "failed", readonly exit: number = EXIT.failed, readonly next: Next[] = []) { super(message); }
}

/** A bad flag or value. Exit code 2. */
export class UsageError extends CliFailure {
  constructor(message: string) { super(message, "usage", EXIT.usage, [{ command: "shipvo help", why: "See the commands and flags." }]); }
}

/** What a command reports on success in `--json` mode. */
export type Done = { code: string; summary: string; data: unknown; next: Next[] };

/**
 * Run `fn` so that stdout holds only the envelope: console.log goes to stderr while it runs.
 * A thrown error becomes a failure envelope (exit 2 for a UsageError, 1 otherwise). Sets process.exitCode.
 */
export async function runJson(fn: () => Promise<Done>, fallbackNext: Next[]): Promise<void> {
  const log = console.log;
  console.log = console.error;
  let doc: Envelope<string, unknown>, exit: number;
  try {
    const d = await fn();
    exit = 0; doc = envelope(d.code, d.summary, d.data, d.next, 0);
  } catch (e) {
    const f = e instanceof CliFailure ? e : null;
    exit = f?.exit ?? EXIT.failed;
    doc = envelope(f?.code ?? "failed", e instanceof Error ? e.message : String(e), {}, f && f.next.length ? f.next : fallbackNext, exit);
  } finally { console.log = log; }
  emit(doc);
  process.exitCode = exit;
}
