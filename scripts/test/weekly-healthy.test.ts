import { describe, it, expect } from "vitest";
import { weeklyHealthyApps, filterHealthyRows, isoWeek } from "../weekly-healthy";

describe("weeklyHealthyApps", () => {
  it("groups distinct apps by ISO week", () => {
    const rows = [
      { app_id: "app-a", received_at: "2026-11-02" },
      { app_id: "app-b", received_at: "2026-11-02" },
      { app_id: "app-a", received_at: "2026-11-09" },
    ];
    const weeks = weeklyHealthyApps(rows);
    expect(weeks.size).toBe(2);
    expect(weeks.get("2026-W45")?.apps).toEqual(new Set(["app-a", "app-b"]));
    expect(weeks.get("2026-W46")?.apps).toEqual(new Set(["app-a"]));
  });

  it("handles full ISO timestamps", () => {
    const rows = [{ app_id: "app-a", received_at: "2026-11-02T10:11:12.345Z" }];
    const weeks = weeklyHealthyApps(rows);
    expect(weeks.get("2026-W45")?.apps).toEqual(new Set(["app-a"]));
  });

  it("marks the sample app", () => {
    const rows = [
      { app_id: "tide-and-tackle", received_at: "2026-11-02" },
      { app_id: "other-app", received_at: "2026-11-02" },
    ];
    const weeks = weeklyHealthyApps(rows);
    const entry = weeks.get("2026-W45");
    expect(entry?.sampleApp).toBe(true);
    expect(entry?.apps.size).toBe(2);
  });

  it("does not mark non-sample apps", () => {
    const rows = [{ app_id: "other-app", received_at: "2026-11-02" }];
    const weeks = weeklyHealthyApps(rows);
    expect(weeks.get("2026-W45")?.sampleApp).toBe(false);
  });

  it("handles empty rows", () => {
    expect(weeklyHealthyApps([]).size).toBe(0);
  });
});

describe("filterHealthyRows", () => {
  it("keeps only applied events", () => {
    const rows = [
      { app_id: "a", received_at: "2026-11-02", event: "applied" },
      { app_id: "b", received_at: "2026-11-02", event: "crash_loop_revert" },
    ];
    expect(filterHealthyRows(rows)).toEqual([{ app_id: "a", received_at: "2026-11-02" }]);
  });
});

describe("isoWeek", () => {
  it("year boundaries", () => {
    expect(isoWeek("2026-01-01")).toBe("2026-W01");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeek("2024-12-30")).toBe("2025-W01");
  });
});
