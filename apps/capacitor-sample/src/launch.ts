/** The version label the page shows: release N reads "vN", the embedded build reads "v1". `serving` is the plugin `status` result, such as "release-2.bundle". */
export function versionLabel(serving?: string): string {
  const n = /^release-(\d+)\.bundle$/.exec(serving ?? "")?.[1];
  return n ? `v${Number(n)}` : "v1";
}

/** Launch hook: writes the label into `#version` and to the device log, and sends it to `reportUrl` when one is set (the iOS Simulator script reads it there). */
export async function announceVersion(label: string, reportUrl?: string, doc: Document | undefined = globalThis.document, f: typeof fetch | undefined = globalThis.fetch): Promise<void> {
  const el = doc?.getElementById("version");
  if (el) el.textContent = label;
  console.log(`[shipvo] version ${label}`);
  if (reportUrl && f) await f(`${reportUrl.replace(/\/$/, "")}/__version?v=${encodeURIComponent(label)}`, { mode: "no-cors" }).catch(() => undefined);
}
