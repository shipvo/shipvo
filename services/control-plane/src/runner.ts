// The spec runner on the server: loads an installed app's spec and runs one data source, action or schedule
// with @shipvo/spec (CEL with cost limits; no eval, no dynamic import). Vault keys are injected at call time
// through runnerSecrets and never appear in a result or a log line.
import { memoryCache, runAction, runSource, RunError } from "@shipvo/spec";
import type { RunContext } from "@shipvo/spec";
import { runnerSecrets } from "./vault-use";
import type { RunSchedule } from "./dispatcher";

type Env = { DB: D1Database; VAULT_MASTER_KEY?: string };
export type LoadSpec = (env: Env, app: string) => Promise<unknown | null>;
export type RunnerOptions = { loadSpec?: LoadSpec; fetch?: RunContext["fetch"]; log?: RunContext["log"] };

type Sched = { id?: string; do?: unknown[] };

// Shared across runs in one isolate; authed entries are keyed by person and app through cacheScope.
const cache = memoryCache();

export const loadStoredSpec: LoadSpec = async (env, app) => {
  const row = await env.DB.prepare("SELECT json FROM app_specs WHERE app_id = ?").bind(app).first<{ json: string }>();
  if (!row) return null;
  try { return JSON.parse(row.json); } catch { return null; }
};

const context = (env: Env, who: { person: string; app: string }, o: RunnerOptions): RunContext => ({
  fetch: o.fetch ?? ((url, init) => fetch(url, init)),
  secrets: runnerSecrets(env, who),
  cache,
  cacheScope: `${who.app}:${who.person}`,
  log: o.log ?? ((e) => console.log("runner", JSON.stringify(e))),
});

async function spec(env: Env, app: string, o: RunnerOptions) {
  const s = await (o.loadSpec ?? loadStoredSpec)(env, app);
  if (!s) throw new RunError("bad_spec", `App ${app} has no spec to run.`);
  return s;
}

/** Run one data source for a person. The result is trimmed to the fields the spec uses. */
export async function runDataSource(env: Env, who: { person: string; app: string }, name: string, o: RunnerOptions = {}) {
  return runSource(await spec(env, who.app, o), name, context(env, who, o));
}

/** Run one action for a person. */
export async function runSpecAction(env: Env, who: { person: string; app: string }, name: string, input: Record<string, unknown> = {}, o: RunnerOptions = {}) {
  return runAction(await spec(env, who.app, o), name, input, context(env, who, o));
}

/**
 * The dispatcher's RunSchedule: runs the schedule's steps for every person who has the app, stores each result,
 * and throws after all people ran if any run failed, so the dispatcher records the failure.
 */
export function scheduleRunner(env: Env, o: RunnerOptions = {}): RunSchedule {
  return async (app, name) => {
    const s = (await spec(env, app, o)) as { schedules?: Sched[]; actions?: Record<string, unknown> };
    const sched = Array.isArray(s.schedules) ? s.schedules.find((x) => x?.id === name) : undefined;
    if (!sched || !Array.isArray(sched.do)) throw new RunError("bad_spec", `App ${app} has no schedule ${name}.`);
    const key = `schedule:${name}`;
    const withStep = { ...s, actions: { ...s.actions, [key]: { do: sched.do } } };
    const { results } = await env.DB.prepare("SELECT person_id FROM phone_apps WHERE app_id = ?").bind(app).all<{ person_id: number }>();
    let failure: unknown;
    for (const p of results ?? []) {
      try {
        const who = { person: String(p.person_id), app };
        const value = await runAction(withStep, key, {}, context(env, who, o));
        await env.DB.prepare("INSERT INTO app_run_results (app_id, name, person, result, at) VALUES (?,?,?,?,?) ON CONFLICT(app_id, name, person) DO UPDATE SET result = excluded.result, at = excluded.at")
          .bind(app, name, p.person_id, JSON.stringify(value ?? null), new Date().toISOString()).run();
      } catch (e) { failure ??= e; }
    }
    if (failure) throw failure;
  };
}
