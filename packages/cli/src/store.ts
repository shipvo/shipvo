import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataSafetyCsv, deriveStoreDetails, formatSummary, renderPrivacyPolicy } from "@shipvo/store";
import { args, loadConfig } from "./config.js";

/** shipvo store details --dry-run [--out dir]: offline; reads shipvo.json only, no credentials, no upload. */
export async function storeCmd(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub !== "details") { console.error("Usage: shipvo store details --dry-run [--out dir]"); return 2; }
  if (!rest.includes("--dry-run")) { console.error("shipvo store details: upload is not available yet; use --dry-run"); return 2; }
  const cfg = loadConfig();
  const d = deriveStoreDetails(cfg);
  const o = args(rest).out;
  const out = o && o !== "true" ? o : "store-details";
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "data-safety.csv"), dataSafetyCsv(d));
  writeFileSync(join(out, "privacy-policy.md"), renderPrivacyPolicy(d, cfg));
  console.log(formatSummary(d) + `\nWrote ${join(out, "data-safety.csv")} and ${join(out, "privacy-policy.md")}. Nothing was uploaded.`);
  return 0;
}
