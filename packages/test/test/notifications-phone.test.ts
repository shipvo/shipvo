import { expect, it } from "vitest";
import { Phone } from "../src/index";

// Builds a Phone whose simulator calls are recorded and answered by `reply`.
function stubPhone(reply: (action: string, extra: Record<string, unknown>) => Record<string, unknown>) {
  const sent: { action: string; extra: Record<string, unknown> }[] = [];
  const phone = new Phone("s1", "http://sim.invalid", "app", "latest");
  phone.call = async (_path, body) => {
    const { session: _s, action, ...extra } = body as { action: string } & Record<string, unknown>;
    sent.push({ action, extra });
    return { ok: true, screen: "Screen", ...reply(action, extra) };
  };
  return { phone, sent };
}

it("receive resolves true when the sim reports delivered", async () => {
  const { phone, sent } = stubPhone(() => ({ delivered: true }));
  expect(await phone.notifications.receive({ title: "Hi", body: "there", data: { a: 1 } })).toBe(true);
  expect(sent[0]).toEqual({ action: "push_notification", extra: { title: "Hi", body: "there", data: { a: 1 } } });
});

it("receive resolves false when permission blocks delivery", async () => {
  const { phone } = stubPhone(() => ({ delivered: false }));
  expect(await phone.notifications.receive({ title: "Hi", body: "there" })).toBe(false);
});

it("receive resolves false when the sim omits delivered", async () => {
  const { phone } = stubPhone(() => ({}));
  expect(await phone.notifications.receive({ title: "Hi", body: "there" })).toBe(false);
});

it("tap sends open_notification with the id and returns the phone", async () => {
  const { phone, sent } = stubPhone(() => ({}));
  expect(await phone.notifications.tap("n7")).toBe(phone);
  expect(sent[0]).toEqual({ action: "open_notification", extra: { id: "n7" } });
});

it("tap without an id opens the newest", async () => {
  const { phone, sent } = stubPhone(() => ({}));
  await phone.notifications.tap();
  expect(sent[0].action).toBe("open_notification");
  expect(sent[0].extra.id).toBeUndefined();
});

it("phone.notifications() still lists the shade", async () => {
  const list = [{ id: "n1", title: "A", body: "b" }];
  const { phone, sent } = stubPhone(() => ({ notifications: list }));
  expect(await phone.notifications()).toEqual(list);
  expect(sent[0].action).toBe("notifications");
});

it("phone.notifications() is empty when the sim sends none", async () => {
  const { phone } = stubPhone(() => ({}));
  expect(await phone.notifications()).toEqual([]);
});
