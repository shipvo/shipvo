import { expect, it } from "vitest";
import { routeStore } from "../src/index";

it("registered company: organization on both, no tester rule", () => {
  const r = routeStore({ company: true });
  expect(r.play.account).toBe("organization");
  expect(r.apple.account).toBe("organization");
  expect(r.play.testerRule).toBe(false);
  expect(r.play.steps.some((s) => s.id === "play-closed-test")).toBe(false);
});

it("no company (default): personal Play with tester rule, individual Apple", () => {
  const r = routeStore({ company: false });
  expect(r.play.account).toBe("personal");
  expect(r.play.testerRule).toBe(true);
  expect(r.play.accountNote).toContain("12 testers");
  expect(r.play.accountNote).toContain("14 days in a row");
  expect(r.apple.account).toBe("individual");
  expect(r.apple.testerRule).toBe(false);
  expect(JSON.stringify(r.apple)).not.toContain("12 testers");
});

it("empty answers equal the no-company default", () => {
  expect(routeStore({} as never).play.account).toBe("personal");
  expect(routeStore({} as never).play.testerRule).toBe(true);
});

it("no company, needs Android now: same accounts, honest note, no bridge", () => {
  const r = routeStore({ company: false, androidNow: true });
  expect(r.play.account).toBe("personal");
  expect(r.play.testerRule).toBe(true);
  expect(r.notes.join(" ")).toContain("no faster Android route");
  expect(JSON.stringify(r)).not.toContain("Publish with Shipvo");
});

it("personal Play account before 13 Nov 2023: exempt", () => {
  const r = routeStore({ company: false, playAccountBefore20231113: true });
  expect(r.play.account).toBe("personal");
  expect(r.play.testerRule).toBe(false);
  expect(JSON.stringify(r.play)).not.toContain("12 testers");
  expect(r.apple.account).toBe("individual");
});

it("step ids are unique within a store", () => {
  for (const a of [{ company: true }, { company: false }, { company: false, playAccountBefore20231113: true }]) {
    const r = routeStore(a);
    for (const s of [r.play, r.apple]) expect(new Set(s.steps.map((x) => x.id)).size).toBe(s.steps.length);
  }
});

import { SHIPVO_TESTERS_GROUP as G } from "../src/index";
it("only personal non-exempt Play accounts mention Shipvo Testers", () => {
  const text = (r: ReturnType<typeof routeStore>) => JSON.stringify([r.play, r.apple]);
  expect(text(routeStore({ company: false }))).toContain(G);
  expect(text(routeStore({ company: false }))).toContain("everyone tests");
  expect(text(routeStore({ company: true }))).not.toContain(G);
  expect(text(routeStore({ company: false, playAccountBefore20231113: true }))).not.toContain(G);
  expect(JSON.stringify(routeStore({ company: false }).apple)).not.toContain(G);
});
