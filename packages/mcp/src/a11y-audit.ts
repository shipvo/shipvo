// Accessibility audit of a screen tree: controls with no accessible name and tap targets below the platform minimum.
export type Skin = "android" | "ios";
export type A11yIssue = { ref: string; role: string; code: "missing_label" | "small_target"; message: string };

const PRESSABLE = new Set(["button", "link", "tab", "checkbox", "switch", "radio", "menuitem", "option"]);
const INPUT = new Set(["textbox", "searchbox", "spinbutton", "combobox"]);
/** Minimum tap target side: 48 dp on the Android style, 44 pt on the iPhone style. */
export const MIN_TARGET: Record<Skin, number> = { android: 48, ios: 44 };

const LINE = /^\s*- '?([\w-]+)(?: "((?:[^"\\]|\\.)*)")?((?: \[[^\]]*\])*)/;

/**
 * Audit the tree `screen` returns. `sizes` is the rendered [width, height] of each ref (the sim's `sizes` action);
 * a ref with no size is not checked for target size.
 */
export function auditAccessibility(tree: string, skin: Skin, sizes: Record<string, [number, number]> = {}): { issues: A11yIssue[] } {
  const min = MIN_TARGET[skin === "ios" ? "ios" : "android"];
  const unit = skin === "ios" ? "pt" : "dp";
  const issues: A11yIssue[] = [];
  for (const raw of tree.split("\n")) {
    const m = LINE.exec(raw);
    if (!m) continue;
    const role = m[1]!;
    const ref = /\[ref=([^\]]+)\]/.exec(m[3] ?? "")?.[1];
    if (!ref || !(PRESSABLE.has(role) || INPUT.has(role))) continue;
    if (!(m[2] ?? "").trim()) issues.push({ ref, role, code: "missing_label", message: `${role} ${ref} has no accessible name: give it a label so TalkBack and VoiceOver can read it.` });
    const z = sizes[ref];
    if (PRESSABLE.has(role) && z && (z[0] < min || z[1] < min)) issues.push({ ref, role, code: "small_target", message: `${role} ${ref} is ${z[0]} x ${z[1]} ${unit}; the minimum is ${min} ${unit} wide and high.` });
  }
  return { issues };
}
