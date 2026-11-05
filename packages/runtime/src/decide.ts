// The release decision, free of React Native and Expo so any framework adapter can import it.
// It mirrors what the Android (ShipvoRuntimeModule.kt, HermesGuard.kt) and iOS (Updater.swift, HermesGuard.swift)
// shells do today after the pointer signature has been verified. It does not verify anything itself.

/** The fields of a verified release pointer body that the decision reads. */
export type PointerFields = {
  app_id: string;
  shell_major: number;
  release: number;
  /** Absent = Android. */
  platform?: "ios";
  min_shell_version?: string;
  hermes_bytecode_version?: unknown;
};

/** What the shell knows about itself. */
export type ShellFacts = {
  platform: "android" | "ios";
  appId: string;
  shellMajor: number;
  /** The shell's own version, for example "1.0.2". */
  shellVersion: string;
  /** The newest release already current, pending or blocked on this device (0 = none). */
  knownRelease: number;
  /** Hermes bytecode version of the embedded bundle. Null or absent = unknown. */
  hermesBytecodeVersion?: number | null;
};

export type ReleaseDecision =
  | { take: true }
  | { take: false; reason: "wrong_platform" | "other_app_or_shell" | "shell_too_old"; release: number }
  /** Not newer than what the device has. Not an error: the check ends with status "none". */
  | { take: false; reason: "not_newer"; release: number }
  /** The shell must also block this release number so it is not tried again. */
  | { take: false; reason: "hermes_bytecode_mismatch"; release: number; block: true; releaseVersion: number; shellVersion: number };

/** True when `a` is an older version than `b`. Compares major.minor.patch; a pre-release tag is ignored; missing parts are 0. */
export function semverLess(a: string, b: string): boolean {
  const parts = (s: string) => s.split("-")[0].split(".").map((x) => { const n = parseInt(x, 10); return Number.isNaN(n) ? 0 : n; });
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/** Only a positive whole number counts as a bytecode version; anything else is unknown. */
function positiveInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 2147483647 ? v : null;
}

/**
 * May this shell take the release a verified pointer names? Checks, in order: platform, app and shell major,
 * newer than known, shell version against `min_shell_version`, Hermes bytecode version.
 * Android pointers carry no `platform`, and the Android shell does not check it today; this function keeps that,
 * so an Android shell accepts any pointer whose platform is absent and rejects `"ios"`.
 */
export function decideRelease(pointer: PointerFields, shell: ShellFacts): ReleaseDecision {
  const release = pointer.release;
  const pointerPlatform = pointer.platform === "ios" ? "ios" : "android";
  if (pointerPlatform !== shell.platform) return { take: false, reason: "wrong_platform", release };
  if (pointer.app_id !== shell.appId || pointer.shell_major !== shell.shellMajor) return { take: false, reason: "other_app_or_shell", release };
  if (release <= shell.knownRelease) return { take: false, reason: "not_newer", release };
  if (semverLess(shell.shellVersion, pointer.min_shell_version ?? "0.0.0")) return { take: false, reason: "shell_too_old", release };
  const rv = positiveInt(pointer.hermes_bytecode_version), sv = positiveInt(shell.hermesBytecodeVersion);
  if (rv !== null && sv !== null && rv !== sv) return { take: false, reason: "hermes_bytecode_mismatch", release, block: true, releaseVersion: rv, shellVersion: sv };
  return { take: true };
}
