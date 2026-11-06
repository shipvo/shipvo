// The server side of the Settings screen: the MCP actions get_settings and set_setting. Errors are SettingsError with a typed `code`.
import { SettingsError, settingPatch, readSettings, describeSettings } from "./settings.mjs";

const read = async (page) => {
  const sys = await page.evaluate(() => globalThis.__pnDevice?.system?.() ?? null);
  if (!sys) throw new SettingsError("no_device", "the app has no simulated device in this session");
  return sys;
};

/** Dark mode and reduce motion also reach the app's CSS media queries (prefers-color-scheme, prefers-reduced-motion). */
export async function syncMedia(page) {
  const sys = await page.evaluate(() => globalThis.__pnDevice?.system?.() ?? null);
  if (sys) await page.emulateMedia({ colorScheme: sys.darkMode ? "dark" : "light", reducedMotion: sys.reduceMotion ? "reduce" : "no-preference" });
}

const view = (sys) => { const settings = readSettings(sys); return { settings, screen: describeSettings(settings) }; };

/** Runs get_settings and set_setting. Returns the result fields. */
export async function settingsAction(page, body) {
  if (body.action === "get_settings") return view(await read(page));
  if (typeof body.key !== "string" || !body.key) throw new SettingsError("unknown_setting", "set_setting needs a key, such as dark_mode or font_size");
  const patch = settingPatch(body.key, body.value); // unknown key and bad value fail before anything changes
  await read(page);
  await page.evaluate((p) => globalThis.__pnDevice.set(p), patch);
  await syncMedia(page);
  return view(await read(page));
}
export const SETTINGS_ACTIONS = ["get_settings", "set_setting"];
