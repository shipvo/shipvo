// Carrying phones from one simulator to another (the hosted service moves them into a new version on deploy).
// An export holds, per phone: its id, app and release, skin and room, the phone backup (backup_phone), and the
// app's mock backend (its orders and request log). Import recreates each phone, then restores the backup and the backend.

export const PHONES_FORMAT = "shipvo.phones/v0";
export class CarryoverError extends Error { constructor(code, message) { super(message); this.code = code; } }

/** The app spec newSession takes for a phone's app and release: a published release stays the same release. */
export function appSpecOf(app, release) {
  const n = /^r?(\d+)$/.exec(String(release ?? ""));
  return n ? `${app}@r${n[1]}` : String(app);
}

const ID = /^[\w-]{1,64}$/;
/** Checks an import before anything changes. A wrong format refuses the whole import; a phone with a problem is
 *  skipped and listed with every problem it has, so one bad phone never costs the others. */
export function checkPhones(body) {
  if (!body || typeof body !== "object" || body.format !== PHONES_FORMAT) throw new CarryoverError("bad_export", `format: expected "${PHONES_FORMAT}"`);
  if (!Array.isArray(body.phones)) throw new CarryoverError("bad_export", "phones: expected a list");
  const phones = [], skipped = [], seen = new Set();
  body.phones.forEach((p, i) => {
    const problems = [];
    if (!p || typeof p !== "object") problems.push(`phones[${i}]: expected an object`);
    else {
      if (typeof p.session !== "string" || !ID.test(p.session)) problems.push(`phones[${i}].session: 1 to 64 letters, digits, _ or -`);
      if (typeof p.app !== "string" || !/^[a-z0-9-]+$/.test(p.app)) problems.push(`phones[${i}].app: an app id`);
      if (p.room != null && (typeof p.room !== "string" || !ID.test(p.room))) problems.push(`phones[${i}].room: 1 to 64 letters, digits, _ or -`);
      if (p.backend != null && (typeof p.backend !== "object" || typeof p.backend.store !== "string")) problems.push(`phones[${i}].backend: { store, log }`);
      if (p.backup != null && typeof p.backup !== "object") problems.push(`phones[${i}].backup: the object from backup_phone`);
      if (!problems.length && seen.has(p.session)) problems.push(`phones[${i}]: session ${p.session} appears more than once`);
    }
    if (problems.length) skipped.push({ index: i, session: typeof p?.session === "string" ? p.session.slice(0, 64) : null, error: problems.join("; ") });
    else { seen.add(p.session); phones.push(p); }
  });
  return { phones, skipped };
}
