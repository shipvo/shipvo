// Picks the browser the simulator launches: system Chrome, system Edge, Playwright's cached Chromium,
// then a one-time `npx playwright install chromium`. Pure: fs and process access are injected.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const INSTALL_COMMAND = "npx playwright install chromium";

/** Where each Playwright channel puts its binary, per platform. */
export function systemBrowserPaths(channel, platform, env) {
  if (platform === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean);
    const rel = channel === "chrome" ? "\\Google\\Chrome\\Application\\chrome.exe" : "\\Microsoft\\Edge\\Application\\msedge.exe";
    return roots.map((r) => r + rel);
  }
  if (platform === "darwin") {
    return channel === "chrome"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"];
  }
  return channel === "chrome"
    ? ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome"]
    : ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable", "/opt/microsoft/msedge/msedge"];
}

const defaultRun = (cmd, args) => spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });

/**
 * Returns the options to pass to `chromium.launch`.
 * Order: system Chrome, system Edge, Playwright cache, one-time install.
 */
export function resolveBrowser({ pw, env = process.env, fileExists = existsSync, run = defaultRun, platform = process.platform, log = (m) => console.error(m) }) {
  for (const channel of ["chrome", "msedge"]) {
    if (systemBrowserPaths(channel, platform, env).some((p) => fileExists(p))) return { channel };
  }
  let cached;
  try { cached = pw.chromium.executablePath(); } catch { cached = undefined; }
  if (cached && fileExists(cached)) return {};
  if (env.SHIPVO_NO_AUTO_INSTALL === "1") {
    throw new Error(`no browser found (Chrome, Edge or Playwright Chromium) and SHIPVO_NO_AUTO_INSTALL=1 is set. Run \`${INSTALL_COMMAND}\``);
  }
  log(`sim: no Chrome, Edge or Chromium found; running \`${INSTALL_COMMAND}\` once (this downloads a browser)...`);
  const [cmd, ...args] = INSTALL_COMMAND.split(" ");
  const res = run(cmd, args);
  if (!res || res.status !== 0 || res.error) {
    throw new Error(`\`${INSTALL_COMMAND}\` failed. Run it yourself and check the output`);
  }
  return {};
}
