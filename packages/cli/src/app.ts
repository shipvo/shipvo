// `shipvo app create`: register this app with the hosted control plane and get a scoped publish token.
// `shipvo app list`: the apps your account has registered.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { savedCreds } from "./login.js";

export async function appCmd(argv: string[]) {
  const [sub] = argv; const c = savedCreds();
  if (!c) { console.error("Not signed in. Run `shipvo login` first."); process.exit(1); }
  if (sub === "list") {
    const r = await fetch(`${c.control}/apps`, { headers: { authorization: `Bearer ${c.key}` } }); const d: any = await r.json();
    if (!r.ok) { console.error(d.hint ?? d.error); process.exit(1); }
    console.log(d.apps.length ? d.apps.map((a: any) => `${a.app_id}  ${a.name}  ${(a.bytes_used / 1048576).toFixed(1)} MB`).join("\n") : "No apps yet. Run `shipvo app create` inside an app made with `shipvo init`.");
    return;
  }
  if (sub === "delete") {
    const id = argv[1]; if (!id || !argv.includes("--yes")) { console.error("Usage: shipvo app delete <app-id> --yes   (removes the app's published files, tokens and registration; installed shells keep the code they have)"); process.exit(2); }
    const r = await fetch(`${c.control}/apps/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${c.key}` } }); const d: any = await r.json();
    if (!r.ok) { console.error(r.status === 404 ? `No app "${id}" on your account.` : d.hint ?? d.error); process.exit(1); }
    console.log(`Deleted "${id}" (${d.files_deleted} files).`); return;
  }
  if (sub !== "create") { console.error("Usage: shipvo app create | list | delete <id> --yes"); process.exit(2); }
  const cfg = loadConfig();
  const r = await fetch(`${c.control}/apps`, { method: "POST", headers: { authorization: `Bearer ${c.key}`, "content-type": "application/json" }, body: JSON.stringify({ app_id: cfg.appId, name: cfg.name, public_key: cfg.publicKey }) });
  const d: any = await r.json();
  if (!r.ok) { console.error(`Could not register "${cfg.appId}": ${d.message ?? d.hint ?? d.error}`); process.exit(1); }
  mkdirSync(join(process.cwd(), ".shipvo"), { recursive: true });
  writeFileSync(join(process.cwd(), ".shipvo", "publish-token"), d.publish_token + "\n", { mode: 0o600 });
  console.log(`${d.created ? "Registered" : "Renewed the publish token for"} "${d.app_id}" (token expires ${String(d.expires_at).slice(0, 10)}).`);
  console.log(`Token saved to .shipvo/publish-token (git-ignored), so \`shipvo publish\` works on this machine now.`);
  console.log(`For CI, add two repository secrets: SHIPVO_PUBLISH_TOKEN (the token) and SHIPVO_SIGNING_SEED (from .shipvo/seed.txt).`);
  if (cfg.controlPlane.replace(/\/$/, "") !== String(d.control_plane).replace(/\/$/, "")) console.log(`Note: shipvo.json controlPlane is ${cfg.controlPlane}, but you registered on ${d.control_plane}. Installed shells only trust the one built into them.`);
  console.log(`Agents can open it once published: open_app("${d.app_id}@latest") with your key from \`shipvo mcp\`.`);
}
