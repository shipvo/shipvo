/** What the store forms need, worked out from the fields of shipvo.json. Pure functions: no files, no network, no credentials. */

/** The parts of shipvo.json this package reads. Extra fields are ignored. */
export type StoreManifest = {
  appId: string;
  name?: string;
  listing?: { website?: string; capabilities?: string[] };
};

/** One Data safety data type, in Google Play's wording. */
export type DataType = { category: string; categoryId: string; type: string; typeId: string };

export type DataSafetyRow = {
  capability: string;
  dataType: DataType;
  /** The app reads this data on the device, because it declares the capability. */
  collected: true;
  /** What the app does with the data. A default for the capability; check it. */
  purpose: string;
  /** Whether the data leaves the device is not in shipvo.json. */
  shared: "unknown";
};

export type UnknownItem = { id: string; question: string; why: string };

export type StoreDetails = {
  appId: string;
  appName: string;
  rows: DataSafetyRow[];
  /** Declared capabilities that read no user data (the OS asks the user, nothing is collected by the app). */
  noDataCapabilities: string[];
  unknown: UnknownItem[];
};

const LOC = { category: "Location", categoryId: "PSL_DATA_TYPES_LOCATION" };

/** Capabilities that touch user data. Keep in step with `Capability` in @shipvo/device. */
export const DATA_CAPABILITIES: Record<string, { dataType: DataType; purpose: string }> = {
  contacts: { dataType: { category: "Contacts", categoryId: "PSL_DATA_TYPES_CONTACTS", type: "Contacts", typeId: "PSL_CONTACTS" }, purpose: "App functionality" },
  location: { dataType: { ...LOC, type: "Precise location", typeId: "PSL_PRECISE_LOCATION" }, purpose: "App functionality" },
  camera: { dataType: { category: "Photos and videos", categoryId: "PSL_DATA_TYPES_PHOTOS_AND_VIDEOS", type: "Photos", typeId: "PSL_PHOTOS" }, purpose: "App functionality" },
  payments: { dataType: { category: "Financial info", categoryId: "PSL_DATA_TYPES_FINANCIAL", type: "Purchase history", typeId: "PSL_PURCHASE_HISTORY" }, purpose: "App functionality" },
  notifications: { dataType: { category: "Device or other IDs", categoryId: "PSL_DATA_TYPES_IDENTIFIERS", type: "Device or other IDs", typeId: "PSL_DEVICE_ID" }, purpose: "App functionality" },
};

/** Capabilities that collect nothing by themselves. */
export const NO_DATA_CAPABILITIES = ["biometrics", "share", "clipboard", "network"] as const;

export function deriveStoreDetails(manifest: StoreManifest): StoreDetails {
  const declared = [...new Set(manifest.listing?.capabilities ?? [])];
  const rows: DataSafetyRow[] = [];
  const noData: string[] = [];
  const unknown: UnknownItem[] = [];
  for (const cap of declared) {
    const m = Object.hasOwn(DATA_CAPABILITIES, cap) ? DATA_CAPABILITIES[cap] : undefined;
    if (m) {
      rows.push({ capability: cap, dataType: m.dataType, collected: true, purpose: m.purpose, shared: "unknown" });
      unknown.push({ id: `shared:${cap}`, question: `Is ${m.dataType.type.toLowerCase()} sent off the device, or to anyone else?`, why: `The app declares "${cap}". shipvo.json does not say where the data goes.` });
    } else if ((NO_DATA_CAPABILITIES as readonly string[]).includes(cap)) noData.push(cap);
    else unknown.push({ id: `capability:${cap}`, question: `What user data does the "${cap}" capability read, and where does it go?`, why: `"${cap}" is not in the mapping table, so no answer was guessed.` });
  }
  if (rows.length) {
    unknown.push({ id: "retention", question: "How long is this data kept, and can users ask you to delete it?", why: "Both stores ask for a deletion route." });
    unknown.push({ id: "encryption", question: "Is the data encrypted in transit?", why: "Play's Data safety form asks this." });
  }
  if (rows.some((r) => r.capability === "location")) unknown.push({ id: "location-precision", question: "Does the app need precise location, or is approximate enough?", why: "The draft says precise. Change it if approximate is enough." });
  if (!manifest.listing?.website) unknown.push({ id: "contact", question: "What contact address and website should the privacy policy show?", why: "shipvo.json has no listing.website." });
  return { appId: manifest.appId, appName: manifest.name || manifest.appId, rows, noDataCapabilities: noData, unknown };
}

/** A draft privacy policy as Markdown. It names only what the manifest declares. */
export function renderPrivacyPolicy(d: StoreDetails, manifest?: StoreManifest): string {
  const out = [
    "> **Review before publishing.** This draft was generated from `shipvo.json`. It is not legal advice. Check every line, fill in the open items, and have it reviewed if your app handles sensitive data.",
    "",
    `# Privacy policy for ${d.appName}`,
    "",
    "## Data the app uses",
    "",
  ];
  if (!d.rows.length && !d.unknown.some((u) => u.id.startsWith("capability:"))) out.push("This app does not declare access to any user data.");
  else {
    for (const r of d.rows) out.push(`- **${r.dataType.type}** (${r.dataType.category}). Used for: ${r.purpose.toLowerCase()}.`);
    for (const u of d.unknown.filter((u) => u.id.startsWith("capability:"))) out.push(`- **${u.id.slice(11)}**: the app declares this capability. [TO FILL IN: what data it reads.]`);
  }
  if (d.rows.length) out.push("", "## Sharing, storage and deletion", "", "[TO FILL IN: whether this data leaves the device, who receives it, how long it is kept, and how users ask for deletion.]");
  out.push("", "## Contact", "", manifest?.listing?.website ? `Website: ${manifest.listing.website}` : "[TO FILL IN: contact email and website.]", "");
  return out.join("\n");
}

const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * Rows for Google Play's Data safety CSV import (columns as in Play Console's template).
 * Only answers derived from the manifest are written; open questions are left out for you to answer in the console.
 */
export function dataSafetyCsv(d: StoreDetails): string {
  const lines = [["Question ID (machine readable)", "Response ID (machine readable)", "Response value", "Answer requirement", "Human-friendly question label"]];
  lines.push(["PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA", "", d.rows.length ? "true" : "false", "REQUIRED", "Does your app collect or share any of the required user data types?"]);
  for (const r of d.rows) {
    lines.push([r.dataType.categoryId, r.dataType.typeId, "true", "OPTIONAL", `Data type: ${r.dataType.category} / ${r.dataType.type} (declared capability: ${r.capability})`]);
    lines.push([`PSL_DATA_USAGE_RESPONSES:${r.dataType.typeId}:PSL_DATA_USAGE_PURPOSE`, "PSL_APP_FUNCTIONALITY", "true", "OPTIONAL", `Purpose for ${r.dataType.type}: ${r.purpose}`]);
  }
  return lines.map((l) => l.map(q).join(",")).join("\n") + "\n";
}

/** What `shipvo store details --dry-run` prints. */
export function formatSummary(d: StoreDetails): string {
  const out = [`Data safety answers for ${d.appName}`];
  if (!d.rows.length) out.push("  (no declared capability reads user data)");
  for (const r of d.rows) out.push(`  ${r.capability}: ${r.dataType.category} / ${r.dataType.type}; collected: yes; purpose: ${r.purpose}; shared: unknown`);
  if (d.noDataCapabilities.length) out.push(`  No data collected by: ${d.noDataCapabilities.join(", ")}`);
  out.push("", d.unknown.length ? "You must answer:" : "Nothing left for you to answer.");
  for (const u of d.unknown) out.push(`  - ${u.question}`);
  return out.join("\n") + "\n";
}
