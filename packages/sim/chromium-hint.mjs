// The fix to print when Playwright cannot find the Chromium build it wants.
export const CHROMIUM_MISSING = /Executable doesn't exist/;
// Linux: the browser exists but shared libraries are missing.
export const LIBS_MISSING = /error while loading shared libraries|Host system is missing dependencies/i;

/** The one-line install command for the resolved playwright version, plus the Linux hint. */
export function chromiumInstallFix(version) {
  const v = version ? ` (playwright ${version})` : "";
  return `run \`npx playwright install chromium\` in the app folder${v}. On Linux, if Chromium then fails to start, run \`npx playwright install --with-deps chromium\` or install the system packages it lists.`;
}

/** The message to print for a launch error. Returns the first line, plus the fix when the browser is not installed. */
export function launchErrorMessage(message, version) {
  const first = String(message).split("\n")[0];
  const base = `could not launch Chromium: ${first}`;
  if (CHROMIUM_MISSING.test(message)) return `${base}\nFix: ${chromiumInstallFix(version)}`;
  if (LIBS_MISSING.test(message)) return `${base}\nFix: system libraries are missing. Run \`npx playwright install-deps chromium\``;
  return base;
}
