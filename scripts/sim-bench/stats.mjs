// Helpers for the simulator bench: summary stats and /proc parsing. No dependencies.

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function max(xs) { return xs.length ? Math.max(...xs) : null; }

// /proc/<pid>/status -> resident memory in MB (VmRSS is in kB), or null if the line is missing (kernel threads, zombies).
export function parseVmRssMb(status) {
  const m = /^VmRSS:\s+(\d+)\s*kB/m.exec(status);
  return m ? Number(m[1]) / 1024 : null;
}
// /proc/<pid>/stat -> parent pid. The command name is in parentheses and may contain spaces or ")", so cut at the last ")".
export function parsePpid(stat) {
  const i = stat.lastIndexOf(")");
  if (i < 0) return null;
  const f = stat.slice(i + 2).split(" ");   // state, ppid, ...
  const n = Number(f[1]);
  return Number.isInteger(n) ? n : null;
}
// Pids of root and all its descendants, from a Map of pid -> ppid.
export function descendants(root, ppids) {
  const out = [root]; const kids = new Map();
  for (const [pid, pp] of ppids) { if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(pid); }
  for (let i = 0; i < out.length; i++) out.push(...(kids.get(out[i]) ?? []));
  return out;
}
