// Whole-phone backup: spec apps with their data, settings and layout; store apps with their permission answers;
// system settings; the clipboard. restore_phone reads it back. checkBackup finds every problem before anything changes.
import { SETTING_KEYS, settingPatch } from "./settings.mjs";

export const BACKUP_FORMAT = "shipvo.phone-backup/v0";
export class BackupError extends Error { constructor(code, message) { super(message); this.code = code; } }

export function makeBackup({ apps, storeApps, settings, clipboard, at = Date.now() }) {
  return { format: BACKUP_FORMAT, at: new Date(at).toISOString(), apps, store_apps: storeApps, settings, clipboard };
}

/** Returns the parts to restore, or throws BackupError("bad_backup") listing every problem. */
export function checkBackup(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new BackupError("bad_backup", "backup: expected the object from backup_phone");
  if (b.format !== BACKUP_FORMAT) throw new BackupError("bad_backup", `format: expected "${BACKUP_FORMAT}"`);
  const problems = [];
  const apps = b.apps ?? [];
  if (!Array.isArray(apps)) problems.push("apps: expected a list");
  const store = b.store_apps ?? [];
  if (!Array.isArray(store)) problems.push("store_apps: expected a list");
  else store.forEach((a, i) => {
    if (!a || typeof a.id !== "string" || !/^[a-z0-9-]+$/.test(a.id)) problems.push(`store_apps[${i}].id: lowercase letters, digits and dashes`);
    else if (typeof a.url !== "string" || !a.url) problems.push(`store_apps[${i}].url: the app's bundle URL`);
    if (a?.permissions != null && (typeof a.permissions !== "object" || Object.values(a.permissions).some((v) => typeof v !== "boolean"))) problems.push(`store_apps[${i}].permissions: permission names to true or false`);
  });
  const settings = b.settings ?? {};
  if (typeof settings !== "object" || Array.isArray(settings)) problems.push("settings: expected an object");
  else for (const [k, v] of Object.entries(settings)) { try { settingPatch(k, v); } catch (e) { problems.push(`settings.${k}: ${e.message}`); } }
  if (b.clipboard != null && (typeof b.clipboard !== "string" || b.clipboard.length > 20000)) problems.push("clipboard: a string up to 20000 characters");
  if (problems.length) throw new BackupError("bad_backup", problems.join("\n"));
  return { apps: Array.isArray(apps) ? apps : [], storeApps: store, settings: Object.fromEntries(SETTING_KEYS.filter((k) => k in settings).map((k) => [k, settings[k]])), clipboard: b.clipboard ?? null };
}
