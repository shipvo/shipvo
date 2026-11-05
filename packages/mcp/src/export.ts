// Turn recorded steps into a @shipvo/test script. Pure: no I/O.
// Refs (e3) change between sessions, so targets are named by their visible text.
export type Step = {
  action: "open" | "tap" | "type" | "scroll" | "back" | "set_device";
  target?: { text: string; role: string; matches: number };
  text?: string;
  fieldLabel?: string;
  passwordLike?: boolean;
  direction?: string;
  device?: object;
  changed?: boolean;
};

// JSON.stringify leaves U+2028 and U+2029 raw, but TypeScript treats them as line breaks.
const q = (s: string) => JSON.stringify(s).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
// Comment text must stay on one line.
const oneLine = (s: string) => s.replace(/[\r\n\u2028\u2029]+/g, " ");
const envName = (label: string) =>
  "SHIPVO_TEST_" + (label.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || "FIELD");
const DIRECTIONS = ["down", "up", "left", "right"];

function lineFor(s: Step): string[] {
  const t = s.target;
  switch (s.action) {
    case "open": return [];
    case "back": return ["await phone.back();"];
    case "set_device": return [`await phone.device.set(${JSON.stringify(s.device ?? {}).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")});`];
    case "scroll": {
      const d = s.direction && DIRECTIONS.includes(s.direction) ? s.direction : "down";
      return [`await phone.scroll(${q(d)});`];
    }
    case "tap":
      if (!t) return ["// TODO: tap without a target"];
      if (t.matches > 1) return [`// TODO: ambiguous target ${oneLine(q(t.text))}`];
      return [`await phone.tap(${q(t.text)});`];
    case "type": {
      const label = s.fieldLabel ?? t?.text;
      if (!label) return ["// TODO: type without a field label"];
      if (t && t.matches > 1) return [`// TODO: ambiguous target ${oneLine(q(label))}`];
      const value = s.passwordLike ? `process.env.${envName(label)}!` : q(s.text ?? "");
      return [`await phone.type(${q(label)}, ${value});`];
    }
  }
}

export function exportTest(app: string, steps: Step[]): string {
  const out = [
    `import { test } from "@shipvo/test/vitest";`,
    `import { openApp } from "@shipvo/test";`,
    ``,
    `test(${q(`recorded session for ${app}`)}, async () => {`,
    `  const phone = await openApp({ app: ${q(app)} });`,
  ];
  for (const s of steps) {
    const lines = lineFor(s);
    for (const l of lines) out.push("  " + l);
    if (s.changed && lines.length && !lines[0]!.startsWith("//") && s.action !== "open") {
      out.push("  await phone.waitFor(/\\S/); // TODO: name the text that should appear");
    }
  }
  out.push("});", "");
  return out.join("\n");
}
