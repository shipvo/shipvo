import { Band, checkPolicy, parsePolicy, type PolicyResult } from "@shipvo/schema";

type BandName = ReturnType<typeof Band.parse>;
const ORDER: BandName[] = ["b0", "b1", "b2"];
export { checkPolicy, type PolicyResult };

/** Reads the `policy` value from a parsed shipvo.json (throws naming the bad field) and checks it. The widest band in `bands` counts. */
export function checkPublishPolicy(rawPolicy: unknown, bands: string[], now = new Date(), env: NodeJS.ProcessEnv = process.env): PolicyResult {
  if (rawPolicy === undefined) return { ok: true };
  const policy = parsePolicy(rawPolicy);
  const parsed = bands.map((b) => {
    const r = Band.safeParse(b);
    if (!r.success) throw new Error(`--bands: unknown band "${b}"`);
    return r.data;
  });
  const band = parsed.reduce((w, b) => (ORDER.indexOf(b) > ORDER.indexOf(w) ? b : w), parsed[0] ?? "b0");
  return checkPolicy(policy, { band, actorKind: env.SHIPVO_ACTOR === "agent" ? "agent" : "human", now });
}
