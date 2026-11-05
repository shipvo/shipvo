import { purposeId, type StoreDetails } from "./derive.js";

const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * Play Data safety import CSV for the answers we could derive. Unknown answers are left out, not guessed.
 * Question and response ids follow Play's template as we know it; export the template from Play Console and compare before you import.
 */
export function renderDataSafetyCsv(d: StoreDetails): string {
  const out: string[][] = [["Question ID", "Response ID", "Response value", "Answer requirement", "Human-friendly question label"]];
  // With no rows we cannot say "false": sign-in and third-party SDKs (see the questions list) may still collect data.
  if (d.rows.length > 0) out.push(["PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA", "", "true", "REQUIRED", "Does your app collect or share any of the required user data types?"]);
  for (const r of d.rows) {
    const q = `PSL_DATA_USAGE_RESPONSES:${r.playType}`;
    if (r.shared !== "unknown") out.push([`${q}:PSL_DATA_USAGE_COLLECTION_AND_SHARING`, r.shared ? "PSL_DATA_USAGE_COLLECTED_AND_SHARED" : "PSL_DATA_USAGE_ONLY_COLLECTED", "", "REQUIRED", `${r.dataType}: collected, shared or both`]);
    if (r.purpose !== "unknown") out.push([`${q}:DATA_USAGE_COLLECTION_PURPOSE`, purposeId(r.purpose), "", "REQUIRED", `${r.dataType}: why it is collected`]);
  }
  return out.map((row) => row.map(cell).join(",")).join("\n") + "\n";
}
