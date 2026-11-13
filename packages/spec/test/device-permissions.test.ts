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

  const scan = {
    ...spec,
    permissions: { device: ["camera", "files"] },
    screens: [
      { id: "home", body: [{ type: "text", value: "Hi" }] },
      { id: "scan", body: [{ type: "stack", children: [{ type: "scanner", label: "Scan" }] }] },
      { id: "upload", body: [{ type: "file", label: "Receipt" }] },
    ],
    actions: {
      open_scan: { do: [{ navigate: "scan" }] },
      open_upload: { do: [{ if: "{{ true }}", then: [{ navigate: "upload" }] }] },
      open_home: { do: [{ navigate: "home" }] },
    },
  };
  it("finds permissions for blocks on a screen an action opens", () => {
    expect(actionDeviceNeeds(scan, "open_scan")).toEqual(["camera"]);
    expect(actionDeviceNeeds(scan, "open_upload")).toEqual(["files"]);
    expect(actionDeviceNeeds(scan, "open_home")).toEqual([]);
  });
  it("a denied camera gives permission_denied and the screen does not open", () => {
    const r = createApp(scan, { devicePermissions: { camera: false } });
    if (!r.ok) throw new Error("bad spec");
    const out = r.app.call("open_scan");
    expect("error" in out && out.error).toMatch(/^permission_denied: .*"camera"/);
    expect(r.app.screen).toBe("home");
    expect(r.app.call("open_upload").ok).toBe(true);
  });
});
