import type { StoreDetails } from "./derive.js";

/** Contact and company fields the founder sets in shipvo.json under `listing.privacy`. */
export type PolicyContact = { company?: string; contactEmail?: string };

export type PolicyDoc = {
  markdown: string;
  html: string;
  /** shipvo.json fields the founder must set before publishing, as `listing.privacy.<name>`. */
  missing: string[];
};

type Block = { h?: 1 | 2; p?: string; li?: string[]; note?: boolean };

const FIELDS: { key: keyof PolicyContact; label: string }[] = [
  { key: "company", label: "the company or person who publishes the app" },
  { key: "contactEmail", label: "a contact email for privacy questions" },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const PLACEHOLDER = (key: string) => `[SET listing.privacy.${key}]`;

/**
 * Pure. Every data use comes from one derived row. Nothing else is claimed:
 * questions the derivation cannot answer are listed for the founder, not guessed.
 */
export function renderPolicyText(d: StoreDetails, contact: PolicyContact = {}): PolicyDoc {
  const missing = FIELDS.filter((f) => !clean(contact[f.key])).map((f) => `listing.privacy.${f.key}`);
  const company = clean(contact.company) || PLACEHOLDER("company");
  const email = clean(contact.contactEmail) || PLACEHOLDER("contactEmail");
  const B: Block[] = [];
  B.push({ note: true, p: "Draft. Review before publishing. Made by `shipvo store policy` from shipvo.json. It is not legal advice." });
  B.push({ h: 1, p: `Privacy policy for ${d.appName}` });
  B.push({ p: `${d.appName} is published by ${company}.` });
  if (d.rows.length === 0) {
    B.push({ p: "The app declares no use of your camera, location, contacts, calendar, files, payments or notifications." });
  } else {
    B.push({ h: 2, p: "What the app uses" });
    B.push({ li: d.rows.map((r) => `${r.dataType}: the app asks for the ${r.capability} permission and uses it for ${r.purpose.toLowerCase()}.`) });
  }
  B.push({ h: 2, p: "Contact" });
  B.push({ p: `Questions about privacy: ${email}.` });
  const open = d.unknown.filter((u) => u.id !== "contact");
  if (open.length) {
    B.push({ h: 2, p: "Still to confirm" });
    B.push({ p: "These answers are not in shipvo.json. Answer them and remove this section before you publish." });
    B.push({ li: open.map((u) => u.question) });
  }
  const markdown = B.map((b) => {
    if (b.note) return `> **${b.p!.split(". ")[0]}.** ${b.p!.split(". ").slice(1).join(". ")}`;
    if (b.h) return `${"#".repeat(b.h)} ${b.p}`;
    if (b.li) return b.li.map((x) => `- ${x}`).join("\n");
    return b.p!;
  }).join("\n\n") + "\n";
  const body = B.map((b) => {
    if (b.note) return `<p><strong>${esc(b.p!)}</strong></p>`;
    if (b.h) return `<h${b.h}>${esc(b.p!)}</h${b.h}>`;
    if (b.li) return `<ul>${b.li.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    return `<p>${esc(b.p!)}</p>`;
  }).join("\n");
  const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Privacy policy for ${esc(d.appName)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem}</style></head><body>\n${body}\n</body></html>\n`;
  return { markdown, html, missing };
}
