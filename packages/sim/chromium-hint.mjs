// The fix to print when Playwright cannot find the Chromium build it wants.
export const CHROMIUM_MISSING = /Executable doesn't exist/;

/** The one-line install command for the resolved playwright version, plus the Linux hint. */
export function chromiumInstallFix(version) {
  const v = version ? ` (playwright ${version})` : "";
  return `run \`npx playwright install chromium\` in the app folder${v}. On Linux, if Chromium then fails to start, run \`npx playwright install install-deps chromium\`.`;
}

/** The message to print for a launch error. Returns the first line, plus the fix when the browser is not installed. */
export function launchErrorMessage(message, version) {
  const first = String(message).split("\n")[0];
  const base = `could not launch Chromium: ${first}`;
  return CHROMIUM_MISSING.test(message) ? `${base}\nFix: ${chromiumInstallFix(version)}` : base;
}
