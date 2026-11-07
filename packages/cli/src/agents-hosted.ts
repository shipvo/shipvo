// `shipvo agents setup --hosted`: write the remote MCP config of the hosted Shipvo phone for each agent.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { TARGETS, detected, mergeJson, mergeToml, remoteBlockFor } from "./agent-targets.js";

export type Creds = { key: string; mcp_url: string };
export const KEY_PLACEHOLDER = "<your Shipvo key>";

/** "tracked": git tracks the file. "unignored": inside a git repo, not tracked, not ignored. "safe": ignored, or not in a repo. */
export function gitState(dir: string, file: string): "tracked" | "unignored" | "safe" {
  const git = (a: string[]) => { try { execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" }); return true; } catch { return false; } };
  if (!git(["rev-parse", "--is-inside-work-tree"])) return "safe";
  if (git(["ls-files", "--error-unmatch", "--", file])) return "tracked";
  return git(["check-ignore", "-q", "--", file]) ? "safe" : "unignored";
}

type Row = { agent: string; name: string; action: "written" | "up-to-date" | "printed" | "not-found" | "skipped"; file?: string; note?: string; block?: string; form?: "header" | "path" };

/** Returns the exit code. The key is written to files only; every line printed shows a placeholder instead. */
export async function hostedSetup(o: { dir: string; home: string; pathVar?: string; dry: boolean; json: boolean; all: boolean; forced: Set<string>; creds: Creds | null; login: () => Promise<Creds | null> }): Promise<number> {
  let creds = o.creds;
  if (!creds && !o.dry) {
    if (!o.json) console.log("No Shipvo key yet. Signing you in first.");
    creds = await o.login();
    if (!creds) { console.error("Sign-in did not finish, so no config was written. Run `shipvo login` and try again."); return 2; }
  }
  const url = (creds?.mcp_url ?? "https://sim.shipvo.dev/mcp").replace(/\/$/, "");
  const real = { url, key: creds?.key ?? KEY_PLACEHOLDER }, shown = { url, key: KEY_PLACEHOLDER };
  const rows: Row[] = [];
  const homeFile = (f: string) => f.startsWith("~/") ? join(o.home, f.slice(2)) : f;
  for (const t of TARGETS) {
    const on = o.all || o.forced.has(t.id) || detected(t, o.dir, o.pathVar);
    const base = { agent: t.id, name: t.label, form: (t.remote!.path ? "path" : "header") as "path" | "header" };
    const block = remoteBlockFor(t, shown);
    if (t.level === "user-print" || (t.level === "user-write" && !on)) {
      rows.push({ ...base, action: t.level === "user-write" ? "not-found" : "printed", file: t.file, block: t.level === "user-write" ? undefined : block, note: t.level === "user-write" ? `not found; add it with --for ${t.id}` : "add it by hand" });
      continue;
    }
    if (t.level === "project" && !on) { rows.push({ ...base, action: "not-found", note: `not found; add it with --for ${t.id}` }); continue; }
    const file = t.level === "project" ? t.file : homeFile(t.file);
    const path = t.level === "project" ? resolve(o.dir, file) : file;
    if (t.level === "project") {
      const g = gitState(o.dir, file);
      if (g !== "safe") {
        const why = g === "tracked" ? `${file} is tracked by git, so a key written there would be committed` : `${file} is not git-ignored, so a key written there could be committed`;
        rows.push({ ...base, action: "printed", file, block, note: `${why}. Not written; paste the block (replace the placeholder with the key from \`shipvo mcp\`), or add ${file} to .gitignore and run again.` });
        continue;
      }
    }
    const old = existsSync(path) ? readFileSync(path, "utf8") : null;
    const rem = t.remote!;
    const next = rem.block ? mergeToml(old, remoteBlockFor(t, real)) : mergeJson(old, t.jsonPath!, rem.entry!(real));
    if (next === null) { rows.push({ ...base, action: "skipped", file, note: `${file} could not be parsed; I left it alone. Fix it and run again.` }); continue; }
    if (next === old) { rows.push({ ...base, action: "up-to-date", file }); continue; }
    if (!o.dry) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, next, { mode: 0o600 }); }
    rows.push({ ...base, action: "written", file });
  }
  const bad = rows.some((r) => r.action === "skipped");
  const chatgpt = `${url}/${KEY_PLACEHOLDER}`;
  if (o.json) console.log(JSON.stringify({ ok: !bad, hosted: true, dry_run: o.dry, url, agents: rows, chatgpt_url: chatgpt }));
  else {
    console.log(`Hosted Shipvo phone: ${url}`);
    for (const r of rows) console.log(`  ${r.name} (${r.agent}): ${r.action === "written" ? (o.dry ? "would write" : "written") : r.action === "up-to-date" ? "already up to date" : r.action === "printed" ? "not written" : r.note}${r.file && r.action !== "not-found" ? ` [${r.file}]` : ""}`);
    for (const r of rows.filter((x) => x.action === "printed")) console.log(`\n${r.name}: ${r.note ?? ""}\n${r.block}`);
    console.log(`\nChatGPT (custom MCP connector, cannot send headers): ${chatgpt}\nThe key is in your saved sign-in; \`shipvo mcp\` prints it for pasting.`);
    if (o.dry) console.log("Dry run: nothing was written.");
  }
  return bad ? 2 : 0;
}
