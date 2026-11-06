// `shipvo approvals list` and `shipvo approvals approve <id>`: see and release promotes held above the policy band.
import { loadConfig, publishToken } from "./config.js";
import { savedCreds } from "./login.js";

export const APPROVALS_HELP = `Usage: shipvo approvals list [--app id] [--json]
       shipvo approvals approve <id> [--app id] [--json]

List promotes held above policy.requireApprovalAbove, or approve one.
A second owner must approve: the proposer cannot, and an agent cannot approve an agent's proposal.

Exit codes: 0 done, 1 refused by a rule (the rule is named), 2 error.
With --json, one line: { ok, command, ... } or { ok: false, error, rule?, message }.

Needs SHIPVO_OWNER_TOKEN or a login (shipvo login) to approve. list also works with the publish token.
`;

type Held = { id: string; release: number; band: string; proposer: string; proposed_at: string };

/** "3m", "2h", "5d". */
export function age(from: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(from)) / 1000));
  if (!Number.isFinite(s)) return "?";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export async function approvals(argv: string[], deps: { fetchFn?: typeof fetch; now?: number } = {}): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) { console.log(APPROVALS_HELP); return 0; }
  const json = argv.includes("--json");
  const out = (doc: Record<string, unknown>, human: string, code: number) => { console.log(json ? JSON.stringify(doc) : human); return code; };
  const fail = (error: string, message: string, extra: Record<string, unknown> = {}, code = 2) => out({ ok: false, error, message, ...extra }, message, code);
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
    return fail(body.error ?? `http_${r.status}`, rule ? `Refused by rule ${rule}: ${msg}` : `Request failed: ${msg}${r.status === 401 ? " (the token was not accepted for this app)" : ""}`, { status: r.status, ...(rule ? { rule } : {}) }, r.status === 403 || r.status === 409 ? 1 : 2);
  }
  if (sub === "approve") return out({ ok: true, command: "approve", app: appId, approval_id: body.approval_id ?? id, status: body.status }, `Approved ${id}. The promote is live.`, 0);
  const rows: Held[] = body.approvals ?? [];
  const human = rows.length
    ? ["ID\tRELEASE\tBAND\tPROPOSER\tAGE", ...rows.map((h) => `${h.id}\t${h.release}\t${h.band}\t${h.proposer}\t${age(h.proposed_at, deps.now)}`)].join("\n")
    : "No promotes are waiting for approval.";
  return out({ ok: true, command: "list", app: appId, approvals: rows.map((h) => ({ id: h.id, release: h.release, band: h.band, proposer: h.proposer, proposed_at: h.proposed_at, age_seconds: Math.max(0, Math.round(((deps.now ?? Date.now()) - Date.parse(h.proposed_at)) / 1000)) })) }, human, 0);
}
