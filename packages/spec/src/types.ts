/** One problem found in a spec. `path` is a JSON path such as `$.screens[0].body[1]`. */
export interface Issue {
  path: string;
  message: string;
  /** What to change so the problem goes away. */
  fix: string;
}

export interface ValidationResult {
  /** Problems that make the spec invalid. */
  errors: Issue[];
  /** Problems that are shown but do not refuse the spec. */
  warnings: Issue[];
}

export function childPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
