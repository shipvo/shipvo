import { describe, expect, it } from "vitest";
import { guardKinds, guardedKind, guardQuestion } from "../src/guard";

describe("approval guard", () => {
  it("is off unless SHIPVO_GUARD names kinds", () => {
    expect(guardKinds(undefined)).toEqual([]);
    expect(guardKinds("off")).toEqual([]);
    expect(guardKinds("on")).toEqual(["pay", "delete"]);
    expect(guardKinds("pay, send,pay,nope")).toEqual(["pay", "send"]);
  });
  it("knows a payment or account-delete button by its label", () => {
    const k = guardKinds("on");
    for (const l of ["Pay", "Pay now", "Pay $12.50", "Buy now", "Buy with GPay", "Place order", "Confirm purchase", "Start subscription", "Transfer"]) expect(guardedKind(l, k), l).toBe("pay");
    for (const l of ["Delete account", "Delete my account", "Close account"]) expect(guardedKind(l, k), l).toBe("delete");
  });
  it("leaves ordinary buttons alone, and asks about Send only when told to", () => {
    const k = guardKinds("on");
    for (const l of ["Add to cart", "Payment methods", "Buy again later", "Delete", "Send", "Paying...", "", undefined]) expect(guardedKind(l, k), String(l)).toBeUndefined();
    expect(guardedKind("Send", guardKinds("send"))).toBe("send");
    expect(guardedKind("Pay", guardKinds("send"))).toBeUndefined();
  });
  it("words the question with the label, the app and what the tap does", () => {
    expect(guardQuestion("Place order", "pay", "myshop")).toBe('The agent wants to tap "Place order" in myshop. This spends money. Allow it?');
  });
});
