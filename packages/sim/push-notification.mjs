// The `push_notification` action: hand a push to the device layer in the page and report whether the app got it.
// `__pnDevice.push` returns the notification id, or nothing when permission blocks it.
export async function pushNotification(page, body) {
  const nid = await page.evaluate((n) => globalThis.__pnDevice?.push(n), { title: body.title ?? "", body: body.body ?? "", data: body.data ?? {} });
  await page.waitForTimeout(200);
  return { delivered: !!nid, id: nid ?? undefined };
}
