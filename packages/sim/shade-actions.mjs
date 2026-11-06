// The server side of the notification shade, Notification Center and Control Center: MCP actions that read and change
// the simulated device in the page. `shade` is per-session state `{ open }`. Errors are ShadeError with a typed `code`.
import { ShadeError, TILES, tileStates, tilePatch, describePanel } from "./shade.mjs";

const read = async (page) => page.evaluate(() => {
  const d = globalThis.__pnDevice; if (!d) return null;
  return { platform: d.state.platform, settings: d.settings(), notifications: d.notifications() };
});
const need = (info) => { if (!info) throw new ShadeError("no_device", "the app has no simulated device in this session"); return info; };
const text = (info, shade) => describePanel(info.platform, shade.open, info.settings, info.notifications);
const view = (info, shade) => ({ panel: shade.open, tiles: shade.open === "notifications" ? [] : tileStates(info.platform, info.settings, shade.open !== "shade"), notifications: info.notifications, screen: text(info, shade) });

/** Dark mode reaches the app as its colour scheme (prefers-color-scheme). */
export async function applyScheme(page, dark) { await page.emulateMedia({ colorScheme: dark ? "dark" : "light" }); }

/** Runs open_notifications, open_control_center, toggle_tile, dismiss_notification, close_panels. Returns the result fields. */
export async function shadeAction(page, shade, body) {
  const info = need(await read(page));
  switch (body.action) {
    case "open_notifications": {
      // Android: the first pull shows quick-settings tiles and notifications, the second expands all tiles. iPhone: Notification Center.
      shade.open = info.platform === "ios" ? "notifications" : (shade.open === "shade" || shade.open === "shade-expanded" || body.expand) ? "shade-expanded" : "shade";
      return view(info, shade);
    }
    case "open_control_center": {
      if (info.platform !== "ios") throw new ShadeError("no_control_center", "an Android phone has no Control Center: its quick-settings tiles are in the notification shade (open_notifications)");
      shade.open = "control"; return view(info, shade);
    }
    case "close_panels": shade.open = "none"; return view(info, shade);
    case "toggle_tile": {
      if (typeof body.tile !== "string" || !body.tile) throw new ShadeError("bad_tile", "toggle_tile needs a tile, such as wifi or dark_mode");
      const patch = tilePatch(info.platform, body.tile, info.settings, body.value); // unknown tile and bad value fail first
      const visible = shade.open === "none" || shade.open === "notifications" ? [] : tileStates(info.platform, info.settings, shade.open !== "shade").map((t) => t.id);
      if (!visible.includes(body.tile)) throw new ShadeError("tile_not_visible", info.platform === "ios" ? `open_control_center first: '${body.tile}' is in Control Center` : `open_notifications first (twice to expand all tiles): '${body.tile}' is not showing`);
      await page.evaluate((p) => globalThis.__pnDevice.set(p), patch);
      if ("darkMode" in patch) await applyScheme(page, patch.darkMode);
      const next = need(await read(page)); return view(next, shade);
    }
    case "dismiss_notification": {
      if (shade.open === "none" || shade.open === "control") throw new ShadeError("panel_closed", "open the notification shade first (open_notifications)");
      if (body.all) { await page.evaluate(() => globalThis.__pnDevice.clearAll()); }
      else {
        const id = body.id ?? info.notifications.at(-1)?.id;
        if (!id || !(await page.evaluate((i) => globalThis.__pnDevice.dismiss(i), id))) throw new ShadeError("no_such_notification", id ? `no notification '${id}' in the shade` : "no notifications to dismiss");
      }
      return view(need(await read(page)), shade);
    }
  }
  throw new ShadeError("unknown_action", body.action);
}
export const SHADE_ACTIONS = ["open_notifications", "open_control_center", "close_panels", "toggle_tile", "dismiss_notification"];
export { TILES };
