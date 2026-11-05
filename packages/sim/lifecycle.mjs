// The `lock`, `unlock` and `restart` actions of Shipvo Phone. All three are simulated and land in `device_log`.
// A restart is a cold start: the page reloads (storage is kept, in-memory device state starts fresh).
export async function lifecycle(page, action) {
  if (action === "lock") await page.evaluate(() => globalThis.__pnDevice?.lock());
  else if (action === "unlock") await page.evaluate(() => globalThis.__pnDevice?.unlock());
  else if (action === "restart") {
    // "networkidle" never comes on apps that poll, so wait for "load" and then for the device layer, with a clear error.
    await page.reload({ waitUntil: "load", timeout: 15000 });
    try { await page.waitForFunction(() => !!globalThis.__pnDevice, null, { timeout: 10000 }); }
    catch { throw new Error("the app did not come back after the restart: the device layer was not ready within 10 s"); }
    await page.evaluate(() => globalThis.__pnDevice?.frameEvent("restart", { storage: "kept" }));
  } else throw new Error(`unknown lifecycle action '${action}'`);
  return { locked: await page.evaluate(() => globalThis.__pnDevice?.locked() ?? false) };
}
// Taps, typing and scrolling reach nothing while the phone shows its lock screen.
export const lockedError = () => new Error("the phone is locked; use the unlock action first");
export async function assertUnlocked(page) {
  if (await page.evaluate(() => globalThis.__pnDevice?.locked?.() ?? false)) throw lockedError();
}
