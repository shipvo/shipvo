// The `lock`, `unlock` and `restart` actions of Shipvo Phone. All three are simulated and land in `device_log`.
// A restart is a cold start: the page reloads (storage is kept, in-memory device state starts fresh).
export async function lifecycle(page, action) {
  if (action === "lock") await page.evaluate(() => globalThis.__pnDevice?.lock());
  else if (action === "unlock") await page.evaluate(() => globalThis.__pnDevice?.unlock());
  else if (action === "restart") {
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(() => globalThis.__pnDevice?.frameEvent("restart", { storage: "kept" }));
  } else throw new Error(`unknown lifecycle action '${action}'`);
  return { locked: await page.evaluate(() => globalThis.__pnDevice?.locked() ?? false) };
}
// Taps, typing and scrolling reach nothing while the phone shows its lock screen.
export const lockedError = () => new Error("the phone is locked; use the unlock action first");
