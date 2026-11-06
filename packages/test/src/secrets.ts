/** Secret values read so far. Shared by the whole process and never cleared. */
const known = new Set<string>();
/** Values shorter than this are not masked: masking `1` would garble every error. */
const MIN_MASK = 4;

/** Read `SHIPVO_TEST_<NAME>` from the environment. Throws, naming the variable, if it is missing or empty. The value is masked as `***` in errors from this package. */
export function secret(name: string): string {
  const key = name.toUpperCase();
  const variable = `SHIPVO_TEST_${key}`;
  const value = process.env[variable];
  if (!value) {
    const err = new Error(`secret "${name}" is not set. Set the environment variable ${variable} (in CI, map a repository secret to it with \`env:\`).`);
    (err as Error & { code?: string }).code = "secret_missing";
    throw err;
  }
  if (value.length >= MIN_MASK) known.add(value);
  return value;
}

/** Replace every secret value that was read so far with `***`. */
export function redact(text: string): string {
  let out = text;
  for (const v of [...known].sort((a, b) => b.length - a.length)) out = out.split(v).join("***");
  return out;
}

/** Replace each `{secret:NAME}` with its value. Throws if a variable is missing. */
export function resolveSecrets(text: string): string {
  return text.replace(/\{secret:([A-Za-z0-9_]+)\}/g, (_m, n: string) => secret(n));
}

/** Read a named test account: `SHIPVO_TEST_ACCOUNT_<NAME>_USER` and `SHIPVO_TEST_ACCOUNT_<NAME>_PASSWORD`. Throws, naming the missing variable, never a value. Both values are masked as `***` afterwards. */
export function account(name: string): { user: string; password: string } {
  const key = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return { user: secret(`ACCOUNT_${key}_USER`), password: secret(`ACCOUNT_${key}_PASSWORD`) };
}
