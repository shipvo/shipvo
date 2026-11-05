/** The parts of shipvo.json that store answers come from. */
export type StoreManifest = {
  appId: string;
  name?: string;
  listing?: { description?: string; website?: string; capabilities?: string[] };
};

export type Answer = boolean | "unknown";

/** One Data safety row: a kind of user data the app can reach. */
export type DataSafetyRow = {
  capability: string;
  /** Play Data safety category and type, in Play's words. */
  category: string;
  dataType: string;
  /** Play Console response id for the data type (used in the CSV). */
  playType: string;
  /** Treated as collected because the app declares the capability (the cautious answer). */
  collected: Answer;
  shared: Answer;
  purpose: string;
};

export type UnknownItem = { id: string; question: string };

export type StoreDetails = {
  appId: string;
  appName: string;
  rows: DataSafetyRow[];
  /** Declared capabilities that touch no user data on their own (nothing to list). */
  noDataCapabilities: string[];
  /** Things the founder must answer. Never dropped silently. */
  unknown: UnknownItem[];
  /** Data safety fields (collected, shared, purpose per row) filled without a human, out of all. */
  fill: { filled: number; total: number };
};

type Mapping = { category: string; dataType: string; playType: string; purpose: string };

/** Capabilities that touch user data. Names match `@shipvo/device`. */
export const DATA_CAPABILITIES: Record<string, Mapping> = {
  camera: { category: "Photos and videos", dataType: "Photos", playType: "PSL_PHOTOS", purpose: "App functionality" },
  location: { category: "Location", dataType: "Precise location", playType: "PSL_PRECISE_LOCATION", purpose: "App functionality" },
  contacts: { category: "Contacts", dataType: "Contacts", playType: "PSL_CONTACTS", purpose: "App functionality" },
  calendar: { category: "Calendar", dataType: "Calendar events", playType: "PSL_CALENDAR", purpose: "App functionality" },
  files: { category: "Files and docs", dataType: "Files and docs", playType: "PSL_FILES_AND_DOCS", purpose: "App functionality" },
  payments: { category: "Financial info", dataType: "Payment info", playType: "PSL_PAYMENT_INFO", purpose: "App functionality" },
  notifications: { category: "Device or other IDs", dataType: "Device or other IDs", playType: "PSL_DEVICE_ID", purpose: "App functionality" },
};

/** Known capabilities that do not by themselves give the app user data. */
export const NO_DATA_CAPABILITIES = ["biometrics", "share", "clipboard", "network"];

const PURPOSE_ID: Record<string, string> = { "App functionality": "PSL_APP_FUNCTIONALITY" };
export const purposeId = (p: string) => PURPOSE_ID[p] ?? "PSL_APP_FUNCTIONALITY";

/** Pure: no file or network access. */
export function deriveStoreDetails(manifest: StoreManifest): StoreDetails {
  const declared = [...new Set((manifest.listing?.capabilities ?? []).map((c) => String(c).trim()).filter(Boolean))];
  const rows: DataSafetyRow[] = [];
  const noData: string[] = [];
  const unknown: UnknownItem[] = [];
  for (const c of declared) {
    const m = Object.hasOwn(DATA_CAPABILITIES, c) ? DATA_CAPABILITIES[c] : undefined;
    if (m) {
      rows.push({ capability: c, category: m.category, dataType: m.dataType, playType: m.playType, collected: true, shared: "unknown", purpose: m.purpose });
      unknown.push({ id: `shared:${c}`, question: `Is ${m.dataType.toLowerCase()} sent to anyone outside your app (a service you use, an analytics tool, another company)?` });
    } else if (NO_DATA_CAPABILITIES.includes(c)) noData.push(c);
    else unknown.push({ id: `capability:${c}`, question: `Capability "${c}" is not in the mapping table. What user data does it touch, is it collected, and is it shared?` });
  }
  unknown.push(
    { id: "sdks", question: "Does the app use any third-party SDK for analytics, ads or crash reports? List each one." },
    { id: "accounts", question: "Does the app ask people to sign in or give a name, email address or phone number?" },
    { id: "deletion", question: "How can a person ask you to delete their data?" },
    { id: "contact", question: "What contact address goes on the privacy policy?" },
  );
  const total = rows.length * 3;
  const filled = rows.reduce((n, r) => n + [r.collected, r.shared, r.purpose].filter((v) => v !== "unknown").length, 0);
  return { appId: manifest.appId, appName: manifest.name || manifest.appId, rows, noDataCapabilities: noData, unknown, fill: { filled, total } };
}
