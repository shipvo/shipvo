// Helpers for the simulator bench: stats and /proc RSS reading. No dependencies.
import { readFileSync, readdirSync } from "node:fs";

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export const max = (xs) => (xs.length ? Math.max(...xs) : null);

// Resident set size in kB from the text of /proc/<pid>/status ("VmRSS:   12345 kB"). null if absent.
export function parseVmRssKb(text) {
  const m = /^VmRSS:\s+(\d+)\s*kB\s*$/m.exec(text);
  return m ? Number(m[1]) : null;
}
// Parent pid from the text of /proc/<pid>/status ("PPid:  1").
export function parsePpid(text) {
  const m = /^PPid:\s+(\d+)\s*$/m.exec(text);
  return m ? Number(m[1]) : null;
}

// Total RSS (MB) of a process and all its descendants. null when /proc is not available.
export function treeRssMb(rootPid, procDir = "/proc") {
  let names;
  try { names = readdirSync(procDir).filter((n) => /^\d+$/.test(n)); } catch { return null; }
  const info = new Map();
  for (const n of names) {
    try { const t = readFileSync(`${procDir}/${n}/status`, "utf8"); info.set(Number(n), { ppid: parsePpid(t), kb: parseVmRssKb(t) }); } catch { /* process exited or unreadable while we scan: skip it */ }
  }
  if (!info.has(rootPid)) return null;
  const keep = new Set([rootPid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, v] of info) if (!keep.has(pid) && keep.has(v.ppid)) { keep.add(pid); grew = true; }
  }
  let kb = 0; for (const pid of keep) kb += info.get(pid).kb ?? 0;
  return Math.round((kb / 1024) * 10) / 10;
}
