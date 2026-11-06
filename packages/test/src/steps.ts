import { PhoneError } from "./phone.js";
import { account, redact, resolveSecrets } from "./secrets.js";
import type { Phone } from "./phone.js";

/** One parsed line. `target` is the quoted text: an accessibility name or visible text, as in the typed API. `role` is optional and narrows which elements a repair may pick. `line` is the 1-based line number in the source text. */
export type Step =
  | { kind: "tap"; target: string; role?: string; line: number }
  | { kind: "type"; target: string; text: string; enter: boolean; role?: string; line: number }
  | { kind: "login"; account: string; line: number }
  | { kind: "scroll"; direction: "down"; line: number }
  | { kind: "back"; line: number }
  | { kind: "see"; text: string; line: number }
  | { kind: "not_see"; text: string; line: number }
  | { kind: "wait_for"; text: string; line: number };

const Q = '"([^"]*)"';
const rules: [RegExp, (m: RegExpMatchArray, line: number) => Step][] = [
  [new RegExp(`^tap ${Q}$`, "i"), (m, line) => ({ kind: "tap", target: m[1]!, line })],
  [new RegExp(`^type ${Q} into ${Q}( and press enter)?$`, "i"), (m, line) => ({ kind: "type", text: m[1]!, target: m[2]!, enter: !!m[3], line })],
  [new RegExp(`^log ?in as ${Q}$`, "i"), (m, line) => ({ kind: "login", account: m[1]!, line })],
  [/^scroll down$/i, (_m, line) => ({ kind: "scroll", direction: "down", line })],
  [/^go back$/i, (_m, line) => ({ kind: "back", line })],
  [new RegExp(`^do not see ${Q}$`, "i"), (m, line) => ({ kind: "not_see", text: m[1]!, line })],
  [new RegExp(`^see ${Q}$`, "i"), (m, line) => ({ kind: "see", text: m[1]!, line })],
  [new RegExp(`^wait for ${Q}$`, "i"), (m, line) => ({ kind: "wait_for", text: m[1]!, line })],
];

/** Turn plain-language lines into typed steps. Blank lines and lines starting with `#` are ignored. An unknown line throws a `PhoneError` with code `step_unparsed`. */
export function parseSteps(text: string): Step[] {
  const steps: Step[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const s = raw.trim();
    if (!s || s.startsWith("#")) return;
    for (const [re, make] of rules) {
      const m = s.match(re);
      if (m) { steps.push(make(m, i + 1)); return; }
    }
    throw new PhoneError(`line ${i + 1}: cannot understand "${s}"`, "step_unparsed");
  });
  return steps;
}

/** Run steps in order. Stops at the first failing step and throws an error that names its line. */
export async function runSteps(phone: Phone, steps: Step[]): Promise<void> {
  for (const s of steps) {
    try {
      switch (s.kind) {
        case "tap": await phone.tap(s.target); break;
        case "type": await phone.type(s.target, resolveSecrets(s.text), s.enter ? { enter: true } : {}); break;
        case "login": {
          // The account is read by name from SHIPVO_TEST_ACCOUNT_<NAME>_USER and _PASSWORD. Values never enter the step.
          const a = account(s.account);
          const fields = phone.nodes().filter((n) => ["textbox", "searchbox"].includes(n.role));
          const pw = fields.find((n) => /password/i.test(n.name) || n.attrs.some((x) => /password/i.test(x)));
          const user = fields.find((n) => n !== pw && /e-?mail|user|login|phone/i.test(n.name)) ?? fields.find((n) => n !== pw);
          if (!user || !pw) throw new PhoneError(`cannot log in as "${s.account}": the screen needs a username field and a password field`, "login_fields_missing");
          await phone.type({ ref: user.ref }, a.user);
          await phone.type({ ref: pw.ref }, a.password);
          const btn = phone.nodes().find((n) => n.role === "button" && /^(log ?in|sign ?in)$/i.test(n.name.trim()));
          if (btn) await phone.tap({ ref: btn.ref });
          break;
        }
        case "scroll": await phone.scroll(s.direction); break;
        case "back": await phone.back(); break;
        case "wait_for": await phone.waitFor(s.text); break;
        // see and not_see put the screen in the message: the catch below redacts it. Keep that.
        case "see": if (!phone.sees(s.text)) throw new Error(`expected to see "${s.text}"\n\nScreen now:\n${phone.screen}`); break;
        case "not_see": if (phone.sees(s.text)) throw new Error(`expected not to see "${s.text}"\n\nScreen now:\n${phone.screen}`); break;
      }
    } catch (e) {
      const err = e as Error;
      throw new PhoneError(`step on line ${s.line} failed: ${redact(err.message)}`, (err as PhoneError).code ?? "step_failed");
    }
  }
}
