import { describe, it, expect } from "vitest";
import { actionDeviceNeeds, createApp, validate } from "../src/index.js";

const spec = {
  spec: "shipvo.app/v0",
  app: { id: "remind", name: "Remind" },
  permissions: { device: ["notifications"] },
  state: { n: { type: "number", default: 0 } },
  screens: [{ id: "home", body: [{ type: "text", value: "Hi" }] }],
  actions: {
    ping: { do: [{ notify: { title: "Hello" } }, { set: "state.n", value: 1 }] },
    plain: { do: [{ set: "state.n", value: 2 }] },
  },
};

describe("device permissions on actions", () => {
  it("the spec is valid", () => { expect(validate(spec).errors).toEqual([]); });
  it("finds the permissions an action needs", () => {
    expect(actionDeviceNeeds(spec, "ping")).toEqual(["notifications"]);
    expect(actionDeviceNeeds(spec, "plain")).toEqual([]);
  });
  it("a denied permission gives permission_denied that names it, and nothing runs", () => {
    const r = createApp(spec, { devicePermissions: { notifications: false } });
    if (!r.ok) throw new Error("bad spec");
    const out = r.app.call("ping");
    expect(out.ok).toBe(false);
    expect("error" in out && out.error).toMatch(/^permission_denied: .*"notifications"/);
    expect(r.app.state.n).toBe(0);
    expect(r.app.call("plain").ok).toBe(true);
  });
  it("an allowed permission works", () => {
    const r = createApp(spec, { devicePermissions: { notifications: true } });
    if (!r.ok) throw new Error("bad spec");
    expect(r.app.call("ping").ok).toBe(true);
    expect(r.app.state.n).toBe(1);
  });
});
