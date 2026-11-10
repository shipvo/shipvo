// Per-app spend limits. The person sets the limit; money actions are checked against it before any call is made.
// Amounts are whole minor units (cents) in the limit's currency. No conversion.
export type SpendEnv = { DB: D1Database };
export type SpendLimit = { amount: number; currency: string; period: "month" };

const monthStart = (now: Date) => `${now.toISOString().slice(0, 7)}-01T00:00:00.000Z`;

const audit = (env: SpendEnv, person: number, app: string, action: string, detail: unknown, now: Date) =>
  env.DB.prepare("INSERT INTO phone_spend_audit (person_id, app_id, action, detail, at) VALUES (?,?,?,?,?)")
    .bind(person, app, action, JSON.stringify(detail), now.toISOString()).run();

/** The person's limit for the app. Default 0: no money moves. */
export async function getLimit(env: SpendEnv, person: number, app: string): Promise<SpendLimit> {
  const r: any = await env.DB.prepare("SELECT amount, currency FROM phone_spend_limits WHERE person_id = ? AND app_id = ?").bind(person, app).first();
  return { amount: r?.amount ?? 0, currency: r?.currency ?? "USD", period: "month" };
}

/** Money spent by the app this month, from the use log. */
export async function spentThisMonth(env: SpendEnv, person: number, app: string, now = new Date()): Promise<number> {
  const r: any = await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM phone_spend WHERE person_id = ? AND app_id = ? AND at >= ?").bind(person, app, monthStart(now)).first();
  return r?.s ?? 0;
}

export async function setLimit(env: SpendEnv, person: number, app: string, limit: { amount: number; currency: string }, now = new Date()) {
  const before = await getLimit(env, person, app);
  await env.DB.prepare("INSERT INTO phone_spend_limits (person_id, app_id, amount, currency, period, updated_at) VALUES (?,?,?,?, 'month', ?) ON CONFLICT (person_id, app_id) DO UPDATE SET amount = excluded.amount, currency = excluded.currency, updated_at = excluded.updated_at")
    .bind(person, app, limit.amount, limit.currency, now.toISOString()).run();
  await audit(env, person, app, "spend_limit_set", { before, after: limit }, now);
}

export type SpendResult = { ok: true } | { ok: false; code: "spend_limit"; limit: number; spent: number };

/**
 * Called for an action the spec marks `money: true`, before any request is made.
 * Allowed: the amount is recorded. Refused: the refusal is audited and nothing is recorded as spent.
 */
export async function authorizeSpend(env: SpendEnv, q: { person: number; app: string; amount: number; currency: string; secret?: string }, now = new Date()): Promise<SpendResult> {
  const limit = await getLimit(env, q.person, q.app);
  const spent = await spentThisMonth(env, q.person, q.app, now);
  const bad = !Number.isInteger(q.amount) || q.amount <= 0;
  if (bad || q.currency !== limit.currency || spent + q.amount > limit.amount) {
    await audit(env, q.person, q.app, "spend_refused", { limit: limit.amount, spent, amount: q.amount, currency: q.currency }, now);
    return { ok: false, code: "spend_limit", limit: limit.amount, spent };
  }
  await env.DB.prepare("INSERT INTO phone_spend (person_id, app_id, secret_name, amount, currency, at) VALUES (?,?,?,?,?,?)")
    .bind(q.person, q.app, q.secret ?? null, q.amount, q.currency, now.toISOString()).run();
  return { ok: true };
}
