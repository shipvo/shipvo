// Before and after screenshots of changed screens for the check comment.
// Images are stored on a branch of the user's own repository with their GITHUB_TOKEN. Nothing is sent to Shipvo.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_COMPARE, SKINS, routableScreens, shotFile, type SkinName } from "./ci-shots.js";

export type ShotPair = { skin: SkinName; before?: string; after?: string };
export type ScreenShots = { screen: string; pairs: ShotPair[] };
export type BeforeAfter = { screens: ScreenShots[]; total: number };

export const MEDIA_BRANCH = "shipvo-check-media";

/** Pair the base and head shots per screen. Screens whose images are identical on every skin did not change visually and are dropped. Images are passed through `url`. */
export function pairShots(changed: string[], beforeDir: string, afterDir: string, url: (file: string, side: "before" | "after", name: string) => string): BeforeAfter {
  const screens: ScreenShots[] = [];
  const all = routableScreens(changed, Infinity);
  for (const [name] of all) {
    const pairs: ShotPair[] = [];
    let differs = false;
    for (const skin of SKINS) {
      const b = join(beforeDir, shotFile(name, skin)), a = join(afterDir, shotFile(name, skin));
      const hasB = existsSync(b), hasA = existsSync(a);
      if (!hasB && !hasA) continue;
      if (hasB !== hasA || (hasB && !readFileSync(b).equals(readFileSync(a)))) differs = true;
      pairs.push({ skin, before: hasB ? url(b, "before", name) : undefined, after: hasA ? url(a, "after", name) : undefined });
    }
    if (pairs.length && differs) screens.push({ screen: name, pairs });
  }
  return { screens: screens.slice(0, MAX_COMPARE), total: screens.length };
}

const label = (s: SkinName) => (s === "ios" ? "iOS" : "Android");
const img = (u: string | undefined, alt: string) => (u ? `<img src="${u}" width="180" alt="${alt}">` : "not captured");

/** The comment section: one table per screen, base and head side by side, Android and iOS. */
export function beforeAfterSection(b: BeforeAfter, runUrl?: string): string[] {
  if (!b.screens.length) return [];
  const L = ["### Before and after", "", "Base commit on the left, this pull request on the right. Light theme, phone size.", ""];
  for (const s of b.screens) {
    L.push(`**\`${s.screen}\`**`, "", "| Skin | Before | After |", "| --- | --- | --- |");
    for (const p of s.pairs) L.push(`| ${label(p.skin)} | ${img(p.before, `${s.screen} before, ${label(p.skin)}`)} | ${img(p.after, `${s.screen} after, ${label(p.skin)}`)} |`);
    L.push("");
  }
  const rest = b.total - b.screens.length;
  if (rest > 0) L.push(`${rest} more changed screen${rest === 1 ? "" : "s"}: ${runUrl ? `see the \`shipvo-check\` artifact of [this run](${runUrl})` : "see the `shipvo-check` artifact of this run"}.`, "");
  return L;
}

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/** Upload one PNG to the media branch with the contents API. Returns a raw URL the comment can embed. The path includes the commit so each push has its own images. */
export async function uploadShot(o: { repo: string; token: string; sha: string; pr: number; side: string; name: string; file: string; fetch?: Fetch }): Promise<string> {
  const f: Fetch = o.fetch ?? (fetch as unknown as Fetch);
  const path = `pr-${o.pr}/${o.sha.slice(0, 12)}/${o.side}/${o.name}`;
  const api = `https://api.github.com/repos/${o.repo}/contents/${path}`;
  const headers = { authorization: `Bearer ${o.token}`, accept: "application/vnd.github+json", "content-type": "application/json" };
  const r = await f(api, { method: "PUT", headers, body: JSON.stringify({ message: `shipvo check: ${o.side} ${o.name}`, content: readFileSync(o.file).toString("base64"), branch: MEDIA_BRANCH }) });
  if (!r.ok && r.status !== 422) throw new Error(`GitHub PUT ${path} answered ${r.status}`);
  return `https://raw.githubusercontent.com/${o.repo}/${MEDIA_BRANCH}/${path}`;
}

/** Make sure the media branch exists; create it at `sha` when it does not. */
export async function ensureMediaBranch(o: { repo: string; token: string; sha: string; fetch?: Fetch }): Promise<void> {
  const f: Fetch = o.fetch ?? (fetch as unknown as Fetch);
  const headers = { authorization: `Bearer ${o.token}`, accept: "application/vnd.github+json", "content-type": "application/json" };
  const base = `https://api.github.com/repos/${o.repo}/git`;
  if ((await f(`${base}/ref/heads/${MEDIA_BRANCH}`, { method: "GET", headers })).ok) return;
  const r = await f(`${base}/refs`, { method: "POST", headers, body: JSON.stringify({ ref: `refs/heads/${MEDIA_BRANCH}`, sha: o.sha }) });
  if (!r.ok) throw new Error(`could not create the ${MEDIA_BRANCH} branch (GitHub answered ${r.status}); the workflow needs contents: write`);
}
