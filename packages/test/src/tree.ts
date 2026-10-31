/** One line of the simulator's screen: the accessibility tree an agent sees. */
export type Node = {
  role: string;
  /** Accessible name: the quoted label (buttons, links, fields, headings). */
  name: string;
  /** Text after the colon (plain text nodes). */
  text: string;
  ref: string;
  /** Raw attribute brackets, e.g. ["level=1", "disabled"]. */
  attrs: string[];
  line: string;
};

const LINE = /^\s*- ([\w-]+)(?: "((?:[^"\\]|\\.)*)")?((?: \[[^\]]*\])*)(?::\s*(.*))?$/;
const unquote = (s: string) => s.replace(/\\(.)/g, "$1");

/** Parse a screen into nodes. Lines that are not elements (url lines, blank) are skipped. */
export function parseScreen(screen: string): Node[] {
  const out: Node[] = [];
  for (const raw of screen.split("\n")) {
    // The snapshot YAML-quotes a line when its name contains ": " or similar: - 'button "a: b" [ref=e1]':
    const q = /^(\s*- )'(.*)'(:?)$/.exec(raw);
    const line = q ? q[1] + q[2]!.replace(/''/g, "'") + q[3] : raw;
    const m = LINE.exec(line);
    if (!m) continue;
    const attrs = [...(m[3] ?? "").matchAll(/\[([^\]]*)\]/g)].map((x) => x[1]!);
    const ref = attrs.find((a) => /^ref=/.test(a))?.slice(4) ?? "";
    if (!ref) continue;
    let text = (m[4] ?? "").trim();
    if (/^".*"$/.test(text)) text = unquote(text.slice(1, -1));
    out.push({ role: m[1]!, name: m[2] === undefined ? "" : unquote(m[2]), text, ref, attrs: attrs.filter((a) => !/^(ref|cursor)=/.test(a)), line: line.trim() });
  }
  return out;
}

/** What to act on: a visible label or text, a pattern, a role and name, or a ref from the screen. */
export type Target = string | RegExp | { role?: string; name?: string | RegExp; ref?: string };

const matches = (v: string, want: string | RegExp, exact: boolean) =>
  want instanceof RegExp ? want.test(v) : exact ? v === want : v.toLowerCase().includes(want.toLowerCase());
const label = (n: Node) => n.name || n.text;

/** Find one element. Exact label wins; otherwise a unique case-insensitive substring. Ambiguity is an error that lists the candidates. */
export function find(nodes: Node[], target: Target, { roles }: { roles?: string[] } = {}): Node {
  const pool = (list: Node[]) => (roles ? list.filter((n) => roles.includes(n.role)) : list);
  const describe = typeof target === "string" ? `"${target}"` : target instanceof RegExp ? String(target) : JSON.stringify(target);
  let hits: Node[];
  if (typeof target === "object" && !(target instanceof RegExp)) {
    if (target.ref) hits = nodes.filter((n) => n.ref === target.ref);
    else hits = nodes.filter((n) => (!target.role || n.role === target.role) && (target.name === undefined || matches(label(n), target.name, typeof target.name === "string")));
  } else {
    const all = pool(nodes).filter((n) => label(n) !== "");
    hits = all.filter((n) => matches(label(n), target, true));
    if (hits.length === 0 && typeof target === "string") hits = all.filter((n) => matches(label(n), target, false));
  }
  if (hits.length === 0) throw new Error(`nothing on screen matches ${describe}`);
  if (hits.length > 1) throw new Error(`${hits.length} elements match ${describe}; be more specific:\n${hits.slice(0, 6).map((n) => "  " + n.line).join("\n")}`);
  return hits[0]!;
}
