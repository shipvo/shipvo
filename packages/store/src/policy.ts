import type { StoreDetails } from "./derive.js";

/** A draft privacy policy in Markdown. It states only what the manifest declares. */
export function renderPrivacyPolicy(d: StoreDetails): string {
  const L: string[] = [];
  L.push("> **Draft. Review before publishing.** Made by `shipvo store details` from shipvo.json. It lists what the app declares and nothing else. It is not legal advice. Fill in every item under \"Still to confirm\".", "");
  L.push(`# Privacy policy for ${d.appName}`, "");
  L.push("## What this app can access", "");
  if (d.rows.length === 0) L.push("The app declares no access to anything on your device beyond the app itself.");
  else {
    L.push("The app declares access to the following:", "");
    for (const r of d.rows) L.push(`- **${r.dataType}**: used for ${r.purpose.toLowerCase()}.`);
  }
  L.push("", "## Still to confirm", "", "These answers are not in shipvo.json. Answer them before you publish this policy.", "");
  for (const u of d.unknown) L.push(`- [ ] ${u.question}`);
  L.push("");
  return L.join("\n");
}
