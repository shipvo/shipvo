// Find what a ref points at in a screen tree, for recorded steps. Pure: no I/O.
// Tree lines look like `- button "Add" [ref=e3]`, or YAML-quoted when they hold a colon.
export type Found = { text: string; role: string; matches: number; passwordLike: boolean };

const unquoteLine = (raw: string) => {
  const q = /^(\s*- )'(.*)'(:.*)?$/.exec(raw);
  return q ? q[1] + q[2]!.replace(/''/g, "'") + (q[3] ?? "") : raw;
};
const parse = (raw: string): { role: string; text: string } | undefined => {
  const m = /^\s*- ([\w-]+)(?: ("(?:[^"\\]|\\.)*"))?/.exec(unquoteLine(raw));
  if (!m) return undefined;
  let text = "";
  try { text = m[2] ? (JSON.parse(m[2]) as string) : ""; } catch { text = m[2]!.slice(1, -1); }
  return { role: m[1]!, text };
};

export function findTarget(tree: string | undefined, ref: string): Found | undefined {
  if (!tree) return undefined;
  const lines = tree.split("\n");
  const mine = lines.find((l) => unquoteLine(l).includes(`[ref=${ref}]`));
  const t = mine && parse(mine);
  if (!t || !t.text) return undefined;
  const matches = lines.filter((l) => parse(l)?.text === t.text).length;
  return { ...t, matches, passwordLike: /pass(word|code)|\bpin\b/i.test(`${t.role} ${t.text}`) };
}
