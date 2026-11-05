import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deriveStoreDetails, renderDataSafetyCsv, renderPrivacyPolicy } from "@shipvo/store";
import { args, loadConfig } from "./config.js";

/** `shipvo store details --dry-run [--out dir]`: print the answers, write two files. Nothing is uploaded; no credentials are read. */
export async function store(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  if (sub !== "details") { console.error("Usage: shipvo store details --dry-run [--out dir]"); process.exit(2); }
  const a = args(rest);
  if (a["dry-run"] === undefined || a["dry-run"] === "false") { console.error("shipvo store details: upload is not available yet; use --dry-run"); process.exit(2); }
  const cfg = loadConfig();
  const d = deriveStoreDetails(cfg);
  const out = a.out && a.out !== "true" ? a.out : ".shipvo/store";
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "data-safety.csv"), renderDataSafetyCsv(d));
  writeFileSync(join(out, "privacy-policy.md"), renderPrivacyPolicy(d));
  console.log(`Data safety answers for ${d.appName} (derived from shipvo.json):`);
  if (d.rows.length === 0) console.log("  No declared capability touches user data.");
  for (const r of d.rows) console.log(`  ${r.dataType}: collected ${r.collected}, shared ${r.shared}, purpose ${r.purpose}`);
  if (d.fill.total > 0) console.log(`Filled without you: ${d.fill.filled} of ${d.fill.total} fields.`);
  console.log(`\nYou still need to answer (${d.unknown.length}):`);
  for (const u of d.unknown) console.log(`  - ${u.question}`);
  console.log(`\nWrote ${join(out, "data-safety.csv")} and ${join(out, "privacy-policy.md")}. Nothing was uploaded.`);
}
