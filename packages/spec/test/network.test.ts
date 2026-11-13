import { describe, it, expect } from "vitest";
import { createApp, describeTree, renderScreen, validate } from "../src/index.js";

const spec = {
  spec: "shipvo.app/v0",
  app: { id: "net", name: "Net" },
  state: { last: { type: "text", default: "" } },
  actions: { check: { description: "Record the network", do: [{ set: "state.last", value: "{{ network.online ? 'up on ' + network.type : 'down' }}" }] } },
  screens: [{ id: "home", title: "Home", body: [
    { type: "text", value: "{{ network.online ? 'Online (' + network.type + ')' : 'You are offline' }}" },
    { type: "text", value: "Last check: {{ state.last }}" },
  ] }],
};

describe("network in expressions", () => {
  it("validates, and a misspelt field is caught", () => {
    expect(validate(spec).errors).toEqual([]);
    const bad = structuredClone(spec); bad.screens[0]!.body[0]!.value = "{{ network.onlin }}";
    expect(validate(bad).errors.map((e) => e.message).join(" ")).toContain("onlin");
  });
  it("defaults to online on Wi-Fi", () => {
    const r = renderScreen(spec, {}); if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(describeTree(r.tree)).toContain("Online (wifi)");
  });
  it("reads the network object on every render and in actions, so a change in place shows", () => {
    const network = { online: true, type: "cellular" as "wifi" | "cellular" | "none" };
    const made = createApp(spec, { network }); if (!made.ok) throw new Error(JSON.stringify(made.errors));
    const app = made.app;
    expect(describeTree(app.render().tree!)).toContain("Online (cellular)");
    network.online = false;
    expect(describeTree(app.render().tree!)).toContain("You are offline");
    app.call("check", {});
    expect(describeTree(app.render().tree!)).toContain("Last check: down");
    network.online = true; network.type = "wifi";
    app.call("check", {});
    expect(describeTree(app.render().tree!)).toContain("Last check: up on wifi");
  });
});
