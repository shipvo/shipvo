// Permission table for release roles. Pure and not wired into auth yet.
export type Role = "viewer" | "developer" | "release_manager" | "admin";

export type Action =
  | "read_summary"
  | "read_audit"
  | "publish"
  | "promote"
  | "approve_hold"
  | "rollback"
  | "halt"
  | "manage_tokens"
  | "manage_app";

const VIEWER: readonly Action[] = ["read_summary", "read_audit"];
const DEVELOPER: readonly Action[] = [...VIEWER, "publish"];
const RELEASE_MANAGER: readonly Action[] = [...DEVELOPER, "promote", "approve_hold", "rollback", "halt"];
const ADMIN: readonly Action[] = [...RELEASE_MANAGER, "manage_tokens", "manage_app"];

const TABLE: Readonly<Record<Role, readonly Action[]>> = {
  viewer: VIEWER,
  developer: DEVELOPER,
  release_manager: RELEASE_MANAGER,
  admin: ADMIN,
};

/** True only if the role is known and its row lists the action. Denies by default. */
export function can(role: Role | string, action: Action | string): boolean {
  if (!Object.prototype.hasOwnProperty.call(TABLE, role)) return false;
  return (TABLE[role as Role] as readonly string[]).includes(action);
}
