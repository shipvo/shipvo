// `shipvo approvals list` and `shipvo approvals approve <id>`: see and release promotes held above the policy band.
import { loadConfig, publishToken } from "./config.js";
import { savedCreds } from "./login.js";
import { envelope, type Next } from "./json-out.js";

export const APPROVALS_HELP = `Usage: shipvo approvals list [--app id] [--json]
       shipvo approvals approve <id> [--app id] [--json]

List promotes held above policy.requireApprovalAbove, or approve one.
A second owner must approve: the proposer cannot, and an agent cannot approve an agent's proposal.

Exit codes: 0 done, 1 refused by a rule (the rule is named), 2 error.
With --json, one line: { ok, code, summary, data, next }, the same envelope as status and doctor.
code is ok, a rule name such as self_approval, or usage, config, no_credentials, unreachable, http_<status>.
The list is in data.approvals.

Approving a hold that an agent proposed (through the publish token) needs a signed-in person (run shipvo login).
SHIPVO_OWNER_TOKEN counts as an agent, so it can approve only holds that a person proposed.
list also works with the publish token.
`;

type Held = { id: string; release: number; band: string; proposer: string; proposed_at: string };

/** "3m", "2h", "5d". */
export function age(from: string, now = Date.now()): string {
  const s = ageSeconds(from, now);
  if (s === null) return "?";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Whole seconds since `from`, or null when the date does not parse. */
export function ageSeconds(from: string, now = Date.now()): number | null {
  const n = Math.round((now - Date.parse(from)) / 1000);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

export async function approvals(argv: string[], deps: { fetchFn?: typeof fetch; now?: number } = {}): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) { console.log(APPROVALS_HELP); return 0; }
  const json = argv.includes("--json");
  const out = (code: string, summary: string, data: Record<string, unknown>, next: Next[], exit: number, human = summary) => {
    console.log(json ? JSON.stringify(envelope(code, summary, data, next, exit)) : human);
    return exit;
  };
  const fail = (code: string, message: string, data: Record<string, unknown> = {}, exit = 2, next: Next[] = []) => out(code, message, data, next, exit);
  const pos: string[] = []; let app: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--app") app = argv[++i]; else if (!argv[i].startsWith("--")) pos.push(argv[i]);
  }
  const [sub, id] = pos;
  if (sub !== "list" && sub !== "approve") return fail("usage", "Usage: shipvo approvals list | approve <id> [--app id] [--json]");
  if (sub === "approve" && !id) return fail("usage", "Usage: shipvo approvals approve <id> [--app id] [--json]");
  let cfg; try { cfg = loadConfig(); } catch (e) { return fail("config", e instanceof Error ? e.message : String(e)); }
  const appId = app ?? cfg.appId;
  const token = process.env.SHIPVO_OWNER_TOKEN?.trim() || savedCreds()?.key || publishToken();
  if (!token) return fail("no_credentials", "No credentials. Set SHIPVO_OWNER_TOKEN, run `shipvo login`, or use the publish token.");
  const base = cfg.controlPlane.replace(/\/$/, "");
  const f = deps.fetchFn ?? fetch;
  const url = `${base}/apps/${encodeURIComponent(appId)}/approvals` + (sub === "approve" ? `/${encodeURIComponent(id)}/approve` : "");
  let r: Response;
  try { r = await f(url, { method: sub === "approve" ? "POST" : "GET", headers: { authorization: `Bearer ${token}` } }); }
  catch (e) { return fail("unreachable", `Could not reach the control plane at ${base} (${e instanceof Error ? e.message : String(e)}).`); }
  const body = (await r.json().catch(() => ({}))) as any;
  if (!r.ok) {
    const rule = body.rule as string | undefined;
    const msg = body.message ?? body.reason ?? body.error ?? `HTTP ${r.status}`;
    const exit = r.status === 403 || r.status === 409 ? 1 : 2;
    const data = { status: r.status, ...(rule ? { rule } : {}) };
    if (rule) {
      const hint = rule === "self_approval" && sub === "approve" ? " If an agent proposed this hold, sign in as a person with shipvo login (SHIPVO_OWNER_TOKEN counts as an agent)." : "";
      const next = rule === "self_approval" && sub === "approve" ? [{ command: "shipvo login", why: "A person's login can approve a hold that an agent proposed." }] : [];
      return fail(rule, `Refused by rule ${rule}: ${msg}${hint}`, data, exit, next);
    }
    return fail(body.error ?? `http_${r.status}`, `Request failed: ${msg}${r.status === 401 ? " (the token was not accepted for this app)" : ""}`, data, exit);
  }
  if (sub === "approve") {
    return out("ok", `Approved ${id}. The promote is live.`, { command: "approve", app: appId, approval_id: body.approval_id ?? id, status: body.status }, [{ command: "shipvo status", why: "Check the release is reporting." }], 0);
  }
  const rows: Held[] = body.approvals ?? [];
  const data = { command: "list", app: appId, approvals: rows.map((h) => ({ id: h.id, release: h.release, band: h.band, proposer: h.proposer, proposed_at: h.proposed_at, age_seconds: ageSeconds(h.proposed_at, deps.now) })) };
  if (!rows.length) return out("ok", "No promotes are waiting for approval.", data, [], 0);
  const cols = rows.map((h) => [h.id, String(h.release), h.band, h.proposer, age(h.proposed_at, deps.now)]);
  const head = ["ID", "RELEASE", "BAND", "PROPOSER", "AGE"];
  const w = head.map((t, i) => Math.max(t.length, ...cols.map((c) => c[i].length)));
  const line = (c: string[]) => c.map((v, i) => v.padEnd(w[i])).join("  ").trimEnd();
  return out("ok", `${rows.length} promote${rows.length === 1 ? " is" : "s are"} waiting for approval.`, data,
    [{ command: `shipvo approvals approve ${rows[0].id}`, why: "Release the oldest hold if you are a second owner." }], 0, [line(head), ...cols.map(line)].join("\n"));
}
