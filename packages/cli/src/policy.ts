import { Band, parsePolicy, type ShipvoPolicy } from "@shipvo/schema";

type BandName = ReturnType<typeof Band.parse>;
export type PolicyResult = { ok: true } | { ok: false; rule: string; reason: string };

const ORDER: BandName[] = ["b0", "b1", "b2"];
const PERCENT: Record<BandName, number> = { b0: 1, b1: 10, b2: 100 };
const STAGE_BAND: Record<number, BandName> = { 1: "b0", 10: "b1" };
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const; // Date#getDay order

/** Checks one publish against the policy. Pure: `now` is read in local time. No policy means no rules. */
export function checkPolicy(policy: ShipvoPolicy | undefined, ctx: { band: BandName; actorKind: "human" | "agent"; now: Date; stageStartedAt?: Date }): PolicyResult {
  if (!policy) return { ok: true };
  const { band, actorKind, now } = ctx;
  const reach = PERCENT[band];
  const cap = policy.maxCohortForAgents;
  if (actorKind === "agent" && cap !== undefined) {
    const capPct = typeof cap === "number" ? cap : PERCENT[cap];
    if (reach > capPct) return { ok: false, rule: "maxCohortForAgents", reason: `an agent-run publish reaches ${reach}% (${band}), but policy.maxCohortForAgents is ${cap}${typeof cap === "number" ? "%" : ` (${capPct}%)`}` };
  }
  const stage = policy.requireStageBeforeFull;
  if (stage && reach === 100) {
    const need = `policy.requireStageBeforeFull needs ${stage.percent}% live for ${stage.minHours}h first`;
    if (!ctx.stageStartedAt) return { ok: false, rule: "requireStageBeforeFull", reason: `this publish reaches 100%, but no release is live at ${stage.percent}% (${need})` };
    const hours = (now.getTime() - ctx.stageStartedAt.getTime()) / 3_600_000;
    if (hours < stage.minHours) return { ok: false, rule: "requireStageBeforeFull", reason: `this publish reaches 100%, but the ${stage.percent}% stage has been live ${Math.floor(hours * 10) / 10}h (${need})` };
  }
  if (policy.maxBand && ORDER.indexOf(band) > ORDER.indexOf(policy.maxBand))
    return { ok: false, rule: "maxBand", reason: `this publish reaches ${band}, but policy.maxBand is ${policy.maxBand}` };
  if (actorKind === "agent" && policy.agentMaxBand && ORDER.indexOf(band) > ORDER.indexOf(policy.agentMaxBand))
    return { ok: false, rule: "agentMaxBand", reason: `an agent-run publish reaches ${band}, but policy.agentMaxBand is ${policy.agentMaxBand}` };
  if (policy.blockedWeekdays) {
    const day = DAYS[now.getDay()], from = policy.blockedAfterHour ?? 0;
    if (policy.blockedWeekdays.includes(day) && now.getHours() >= from)
      return { ok: false, rule: "blockedWeekdays", reason: `publishing is blocked on ${day} from ${String(from).padStart(2, "0")}:00 local time (policy.blockedWeekdays${policy.blockedAfterHour !== undefined ? ", policy.blockedAfterHour" : ""})` };
  }
  return { ok: true };
}

/** Reads the `policy` value from a parsed shipvo.json (throws naming the bad field) and checks it. The widest band in `bands` counts. */
export function checkPublishPolicy(rawPolicy: unknown, bands: string[], now = new Date(), env: NodeJS.ProcessEnv = process.env, stageStartedAt?: Date): PolicyResult {
  if (rawPolicy === undefined) return { ok: true };
  const policy = parsePolicy(rawPolicy);
  const parsed = bands.map((b) => {
    const r = Band.safeParse(b);
    if (!r.success) throw new Error(`--bands: unknown band "${b}"`);
    return r.data;
  });
  const band = parsed.reduce((w, b) => (ORDER.indexOf(b) > ORDER.indexOf(w) ? b : w), parsed[0] ?? "b0");
  return checkPolicy(policy, { band, actorKind: env.SHIPVO_ACTOR === "agent" ? "agent" : "human", now, stageStartedAt });
}

/** Band whose pointer says when the stage went live, or undefined if the policy has no stage rule. */
export const stageBandOf = (rawPolicy: unknown): BandName | undefined => {
  const p = rawPolicy === undefined ? undefined : parsePolicy(rawPolicy);
  return p?.requireStageBeforeFull ? STAGE_BAND[p.requireStageBeforeFull.percent] : undefined;
};
