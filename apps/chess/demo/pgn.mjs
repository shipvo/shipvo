// Turns the game the page reports into PGN text. `san` comes from the app (src/san.ts); `result` is the app's result text.
export function pgnResult(result) {
  if (!result) return "*";
  if (/wins/.test(result)) return /white wins/.test(result) ? "1-0" : "0-1";
  return /draw/i.test(result) ? "1/2-1/2" : "*";
}

/** @param {{ san?: string[], result?: string | null, white?: string, black?: string, date?: Date, event?: string }} game */
export function formatPgn({ san = [], result = null, white = "White", black = "Black", date = new Date(), event = "Shipvo Phone chess" }) {
  const token = pgnResult(result);
  const d = date.toISOString().slice(0, 10).replace(/-/g, ".");
  const tag = (k, v) => `[${k} "${String(v).replace(/["\\]/g, "")}"]`;
  const tags = [tag("Event", event), tag("Site", "Shipvo Phone"), tag("Date", d), tag("Round", "1"), tag("White", white), tag("Black", black), tag("Result", token)];
  if (result && /^Time out/.test(result)) tags.push(tag("Termination", "time forfeit"));
  const text = [];
  san.forEach((m, i) => text.push(i % 2 === 0 ? `${i / 2 + 1}. ${m}` : m));
  text.push(token);
  // Wrap the move text at 80 columns, as PGN readers expect.
  const lines = [];
  let line = "";
  for (const w of text) {
    if (line && line.length + 1 + w.length > 80) { lines.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  lines.push(line);
  return `${tags.join("\n")}\n\n${lines.join("\n")}\n`;
}
