// Search across the phone: finds text in every spec app's collections and in the notifications.
// Pure function over data the server already holds; nothing is written.

export class SearchError extends Error { constructor(code, message) { super(message); this.code = code; } }

const MAX_LIMIT = 100;
const SNIPPET = 160;

const flat = (v) => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : null);

function clip(text, at, len) {
  const from = Math.max(0, at - 40);
  const out = text.slice(from, from + SNIPPET);
  return (from > 0 ? "…" : "") + out + (from + SNIPPET < text.length ? "…" : "");
}

/**
 * apps: [{ id, name, data: { collection: rows[] } }]
 * notifications: [{ id, app, title, body }]
 * opts: { query, app?, limit? }
 * Returns { query, count, truncated, results: [{ kind, app, appName, collection?, id?, field, snippet, row? }] }
 */
export function searchPhone(apps, notifications, opts = {}) {
  const q = typeof opts.query === "string" ? opts.query.trim() : "";
  if (!q) throw new SearchError("bad_query", "query: give the text to look for");
  if (q.length > 200) throw new SearchError("bad_query", "query: up to 200 characters");
  const limit = opts.limit == null ? 20 : Number(opts.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new SearchError("bad_limit", `limit: a whole number from 1 to ${MAX_LIMIT}`);
  const only = opts.app == null ? null : String(opts.app);
  if (only && !apps.some((a) => a.id === only) && only !== "notifications") throw new SearchError("not_installed", `'${only}' is not an app on this phone`);
  const needle = q.toLowerCase();
  const results = []; let total = 0;
  const add = (r) => { total++; if (results.length < limit) results.push(r); };

  for (const a of apps) {
    if (only && only !== a.id) continue;
    for (const [collection, rows] of Object.entries(a.data ?? {})) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        for (const [field, value] of Object.entries(row)) {
          const t = flat(value);
          if (t == null) continue;
          const at = t.toLowerCase().indexOf(needle);
          if (at < 0) continue;
          add({ kind: "row", app: a.id, appName: a.name, collection, id: row.id ?? null, field, snippet: clip(t, at), row });
          break; // one hit per row
        }
      }
    }
  }
  if (!only || only === "notifications") {
    for (const n of notifications ?? []) {
      for (const field of ["title", "body"]) {
        const t = flat(n?.[field]);
        if (t == null) continue;
        const at = t.toLowerCase().indexOf(needle);
        if (at < 0) continue;
        add({ kind: "notification", app: n.app ?? null, appName: n.app ?? null, id: n.id ?? null, field, snippet: clip(t, at) });
        break;
      }
    }
  }
  return { query: q, count: total, truncated: total > results.length, results };
}
