// `shipvo keys ... --json`: status, export, import and rotate as one envelope. Wraps the text commands, so their output paths are untouched.
// The seed is never in an envelope or on a stream: export needs --out, and import reports only the public key.
import { args, loadConfig } from "./config.js";
import { keys } from "./login.js";
import { signingKey } from "./signing.js";
import { CliFailure, UsageError, captureLog, runJson, trapExit, type Done, type Next } from "./json-out.js";

const LOGIN: Next = { command: "shipvo login", why: "Sign in again." };
const FALLBACK: Next[] = [{ command: "shipvo doctor --json", why: "Check your setup." }];

function project() {
  try { return loadConfig(); }
  catch (e) { throw new CliFailure(e instanceof Error ? e.message : String(e), "no_project", 1, [{ command: "shipvo init . --yes --json", why: "Add Shipvo to this app." }, { command: "shipvo init myapp --json", why: "Or start a new app." }]); }
}

const failIn = (table: [RegExp, string, Next[]][], fallbackCode = "failed") => (m: string, st: number) => {
  const hit = table.find(([re]) => re.test(m));
  return new CliFailure(m, st === 2 ? "usage" : hit?.[1] ?? fallbackCode, st, hit?.[2] ?? FALLBACK);
};

export async function keysJson(argv: string[]) {
  const [sub, ...rest] = argv.filter((x) => x !== "--json");
  const rawRest = rest;
  return runJson(async (): Promise<Done> => {
    if (sub === undefined) {
      const lines = await captureLog(() => trapExit(() => keys(), failIn([
        [/Not signed in/, "not_signed_in", [LOGIN]], [/expired/, "key_expired", [LOGIN]], [/not valid any more/, "key_invalid", [LOGIN]],
      ])));
      const d = JSON.parse(lines.join("\n"));
      return { code: "ok", summary: `Signed in as ${d.login}. Key ${d.prefix}… has used ${d.used_minutes} of ${d.quota_minutes} sandbox minutes.`, data: d, next: [{ command: "shipvo app create", why: "Register the app and save a publish token." }, { command: "shipvo doctor --json", why: "Check the setup." }] };
    }
    if (sub !== "export" && sub !== "import" && sub !== "rotate" && sub !== "root") throw new UsageError(`Unknown keys command "${sub}". Use keys, keys export, keys import, keys root or keys rotate.`);
    const cfg = project();
    if (sub === "export") {
      const out = args(rawRest).out;
      if (!out || out === "true") throw new UsageError("keys export --json needs --out <file>. The seed is never printed in an envelope.");
      await trapExit(() => signingKey(["export", ...rawRest]), failIn([
        [/Set SHIPVO_SIGNING_SEED/, "no_seed", [{ command: "shipvo keys import", why: "Restore the seed on this machine." }]],
        [/does not match the public key/, "seed_mismatch", [{ command: "shipvo keys import", why: "Restore the seed that matches shipvo.json." }]],
      ]));
      return { code: "exported", summary: `Seed for "${cfg.appId}" written to ${out}. Move it to a password manager, then delete the file.`, data: { app_id: cfg.appId, public_key: cfg.publicKey, out }, next: [{ command: `shipvo keys import --file ${out}`, why: "Restore it on another machine." }] };
    }
    if (sub === "import") {
      const lines = await captureLog(() => trapExit(() => signingKey(["import", ...rawRest]), failIn([
        [/Usage: shipvo keys import/, "usage", [{ command: "shipvo keys import --file seed.txt", why: "Read the seed from a file." }]],
        [/does not look like/, "invalid_seed", [{ command: "shipvo keys import --file seed.txt", why: "Use the seed that `shipvo keys export` saved." }]],
        [/belongs to a different key/, "seed_mismatch", [{ command: "shipvo keys import --file seed.txt", why: "Use the seed for this app's public key." }]],
      ])));
      const text = lines.join("\n");
      return {
        code: /Already in place/.test(text) ? "unchanged" : "imported",
        summary: /Already in place/.test(text) ? "The seed was already in place. Nothing to do." : `Signing key for "${cfg.appId}" restored to .shipvo/seed.txt (matches shipvo.json).`,
        data: { app_id: cfg.appId, public_key: cfg.publicKey, seed_file: ".shipvo/seed.txt", gitignore_warning: /\.gitignore does not ignore/.test(text) },
        next: [{ command: "shipvo login", why: "Sign in on this machine." }, { command: "shipvo app create", why: "Get a publish token on this machine." }],
      };
    }
    if (sub === "root") {
      const lines = await captureLog(() => trapExit(() => signingKey(["root", ...rawRest, "--json"]), failIn([
        [/^Usage:/, "usage", [{ command: "shipvo keys root --out root-seed.txt", why: "Create the root key." }]],
        [/already exists/, "exists", [{ command: "shipvo keys root --out root-seed-2.txt", why: "Use a new file name." }]],
      ], "root_failed")));
      const out = JSON.parse(lines.join("\n"));
      return { code: "root_created", summary: `Root key written to ${out.file}. Pin the public key. The seed is not printed.`, data: out, next: [{ command: "shipvo keys rotate sign --root-seed-file <file> --new-key <public key> --sequence 1", why: "Sign a rotation with it." }] };
    }
    // rotate sign | upload. The signed envelope is public, so it is safe in data.
    const lines = await captureLog(() => trapExit(() => signingKey(["rotate", ...rawRest, "--json"]), failIn([
      [/^Usage:/, "usage", [{ command: "shipvo keys rotate sign --root-seed-file <file> --new-key <public key> --sequence <n>", why: "Sign a rotation statement offline." }]],
      [/Not signed in/, "not_signed_in", [LOGIN]],
      [/refused the statement/, "refused", FALLBACK],
      [/Could not reach/, "remote_failed", FALLBACK],
    ], "rotate_failed")));
    const out = JSON.parse(lines.join("\n"));
    if (rest[0] === "sign") return { code: "rotation_signed", summary: `Signed rotation statement ${args(rest).sequence} for "${cfg.appId}". Save data.envelope to a file, then upload it.`, data: { app_id: cfg.appId, envelope: out }, next: [{ command: "shipvo keys rotate upload <file>", why: "Upload the saved envelope. Needs shipvo login as the app owner." }] };
    return { code: "rotation_uploaded", summary: "Uploaded. Phones switch when they next fetch it.", data: { app_id: cfg.appId, response: out }, next: [{ command: "shipvo status --json", why: "Check the app." }] };
  }, FALLBACK);
}
