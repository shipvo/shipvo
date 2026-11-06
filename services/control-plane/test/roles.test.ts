import { describe, it, expect } from "vitest";
import { can, type Action, type Role } from "../src/roles";

const ACTIONS: Action[] = [
  "read_summary", "read_audit", "publish", "promote", "approve_hold",
  "rollback", "halt", "manage_tokens", "manage_app",
];
const ROLES: Role[] = ["viewer", "developer", "release_manager", "admin"];

// Order of ACTIONS. 1 = allowed.
const EXPECTED: Record<Role, number[]> = {
  viewer:          [1, 1, 0, 0, 0, 0, 0, 0, 0],
  developer:       [1, 1, 1, 0, 0, 0, 0, 0, 0],
  release_manager: [1, 1, 1, 1, 1, 1, 1, 0, 0],
  admin:           [1, 1, 1, 1, 1, 1, 1, 1, 1],
};

describe("can", () => {
  it("matches the expected role x action matrix", () => {
    for (const r of ROLES) {
      ACTIONS.forEach((a, i) => {
        expect(can(r, a), `${r} ${a}`).toBe(EXPECTED[r][i] === 1);
      });
    }
  });

  it("makes each higher role a superset of the one below", () => {
    for (let i = 1; i < ROLES.length; i++) {
      const lower = ACTIONS.filter((a) => can(ROLES[i - 1], a));
      const higher = ACTIONS.filter((a) => can(ROLES[i], a));
      for (const a of lower) expect(higher).toContain(a);
      expect(higher.length).toBeGreaterThan(lower.length);
    }
  });

  it("denies unknown roles and actions", () => {
    expect(can("root", "read_summary")).toBe(false);
    expect(can("admin", "delete_everything")).toBe(false);
    expect(can("", "")).toBe(false);
    expect(can("toString", "read_summary")).toBe(false);
    expect(can("__proto__", "read_summary")).toBe(false);
  });
});
