import type { StoreDetails } from "./derive.js";

/** Contact and company fields the founder sets in shipvo.json under `listing.privacy`. */
export type PolicyContact = { company?: string; contactEmail?: string };

export type PolicyDoc = {
  markdown: string;
  html: string;
  /** shipvo.json fields the founder must set before publishing, as `listing.privacy.<name>`. */
  missing: string[];
};

type Block = { h?: 1 | 2; p?: string; li?: string[]; note?: { lead: string; rest: string } };

const FIELDS: { key: keyof PolicyContact; label: string }[] = [
  { key: "company", label: "the company or person who publishes the app" },
  { key: "contactEmail", label: "a contact email for privacy questions" },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mdEsc = (s: string) => s.replace(/[\\`*_{}[\]()<>#+!|~&-]/g, "\\$&");
const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const PLACEHOLDER = (key: string) => `[SET listing.privacy.${key}]`;

/**
 * Pure. Every data use comes from one derived row. Nothing else is claimed:
 * questions the derivation cannot answer are listed for the founder, not guessed.
 */
export function renderPolicyText(d: StoreDetails, contact: PolicyContact = {}): PolicyDoc {
  const missing = FIELDS.filter((f) => !clean(contact[f.key])).map((f) => `listing.privacy.${f.key}`);
  const build = (u: (s: string) => string): Block[] => {
    const company = clean(contact.company) ? u(clean(contact.company)) : PLACEHOLDER("company");
    const email = clean(contact.contactEmail) ? u(clean(contact.contactEmail)) : PLACEHOLDER("contactEmail");
    const name = u(d.appName);
    const B: Block[] = [];
    B.push({ note: { lead: "Draft.", rest: "Review before publishing. Made by `shipvo store policy` from shipvo.json. It is not legal advice." } });
    B.push({ h: 1, p: `Privacy policy for ${name}` });
    B.push({ p: `${name} is published by ${company}.` });
    const hasOpenCapability = d.unknown.some((x) => x.id.startsWith("capability:"));
    if (d.rows.length === 0) {
      if (!hasOpenCapability) B.push({ p: "The app declares no use of your camera, location, contacts, calendar, files, payments or notifications." });
      else B.push({ p: "Data uses are listed under Still to confirm." });
    } else {
      B.push({ h: 2, p: "What the app uses" });
      B.push({ li: d.rows.map((r) => `${r.dataType}: the app asks for the ${r.capability} permission and uses it for ${r.purpose.toLowerCase()}.`) });
    }
    B.push({ h: 2, p: "Contact" });
    B.push({ p: `Questions about privacy: ${email}.` });
    const open = d.unknown.filter((x) => x.id !== "contact");
    if (open.length) {
      B.push({ h: 2, p: "Still to confirm" });
      B.push({ p: "These answers are not in shipvo.json. Answer them and remove this section before you publish." });
      B.push({ li: open.map((x) => x.question) });
    }
    return B;
  };
  const MB = build(mdEsc);
  const B = build((x) => x);
  const markdown = MB.map((b) => {
    if (b.note) return `> **${b.note.lead}** ${b.note.rest}`;
    if (b.h) return `${"#".repeat(b.h)} ${b.p}`;
    if (b.li) return b.li.map((x) => `- ${x}`).join("\n");
    return b.p!;
  }).join("\n\n") + "\n";
  const body = B.map((b) => {
    if (b.note) return `<p><strong>${esc(`${b.note.lead} ${b.note.rest}`)}</strong></p>`;
    if (b.h) return `<h${b.h}>${esc(b.p!)}</h${b.h}>`;
    if (b.li) return `<ul>${b.li.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    return `<p>${esc(b.p!)}</p>`;
  }).join("\n");
  const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Privacy policy for ${esc(d.appName)}</title><style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem}</style></head><body>\n${body}\n</body></html>\n`;
  return { markdown, html, missing };
}
