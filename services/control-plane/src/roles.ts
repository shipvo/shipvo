// Permission table for release roles, plus the helper routes use to enforce it.
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

/** A token with no role acts as admin, so tokens made before roles existed keep working. */
export const roleOf = (role: string | null | undefined): string => role ?? "admin";

/** The 403 body for a denied action, or null when the role may do it. */
export function forbidden(role: string | null | undefined, action: Action): { error: "forbidden"; action: Action; role: string } | null {
  const r = roleOf(role);
  return can(r, action) ? null : { error: "forbidden", action, role: r };
}
