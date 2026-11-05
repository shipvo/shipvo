import { describe, it, expect } from "vitest";
import { weeklyHealthyApps } from "../weekly-healthy";

describe("weeklyHealthyApps", () => {
  it("groups distinct apps by ISO week", () => {
    const rows = [
      { app_id: "app-a", published_at: "2026-11-02" },
      { app_id: "app-b", published_at: "2026-11-02" },
      { app_id: "app-a", published_at: "2026-11-09" },
    ];
    const weeks = weeklyHealthyApps(rows);
    expect(weeks.size).toBe(2);
    expect(weeks.get("2026-W44")?.apps).toEqual(new Set(["app-a", "app-b"]));
    expect(weeks.get("2026-W45")?.apps).toEqual(new Set(["app-a"]));
  });

  it("marks the sample app", () => {
    const rows = [
      { app_id: "tide-and-tackle", published_at: "2026-11-02" },
      { app_id: "other-app", published_at: "2026-11-02" },
    ];
    const weeks = weeklyHealthyApps(rows);
    const entry = weeks.get("2026-W44");
    expect(entry?.sampleApp).toBe(true);
    expect(entry?.apps.size).toBe(2);
  });

  it("does not mark non-sample apps", () => {
    const rows = [{ app_id: "other-app", published_at: "2026-11-02" }];
    const weeks = weeklyHealthyApps(rows);
    expect(weeks.get("2026-W44")?.sampleApp).toBe(false);
  });

  it("handles empty rows", () => {
    expect(weeklyHealthyApps([]).size).toBe(0);
  });
});
