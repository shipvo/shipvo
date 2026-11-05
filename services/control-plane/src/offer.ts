import { checkNativeModules } from "@shipvo/schema";
import type { ReleasePointerBody } from "@shipvo/schema";

type Body = ReturnType<typeof ReleasePointerBody.parse>;

export type OfferInput = {
  /** The parsed release pointer body. */
  body: Body;
  /** The `?hbc=` query value, or undefined. */
  hbc?: string;
  /** The `?nm=` query value, or undefined. */
  nm?: string;
  /** The raw value stored under `halt/<app>`, or null/undefined when there is none. */
  haltedRelease?: string | null;
};

export type OfferResult =
  | { ok: true; release: number }
  | { ok: false; status: 400 | 404; error: string; [detail: string]: unknown };

/**
 * Decide whether a shell may be offered this release. Pure: no request, KV or framework types.
 * Rules, in order: Hermes bytecode, native modules, halt. A halt for another release or a corrupt halt value is ignored.
 */
export function decideOffer({ body, hbc, nm, haltedRelease }: OfferInput): OfferResult {
  // A shell may say which Hermes bytecode versions it runs: ?hbc=96,98. Without it, every release is offered.
  if (hbc !== undefined && body.hermes_bytecode_version !== undefined) {
    const ok = hbc.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (ok.length === 0) return { ok: false, status: 400, error: "bad_request" };
    if (!ok.includes(body.hermes_bytecode_version)) return { ok: false, status: 404, error: "hermes_bytecode_mismatch" };
  }
  // A shell may list its native modules: ?nm=@scope/pkg@1.2.3,other@2.0.0. Without it, or without required_native_modules, every release is offered.
  if (nm !== undefined && body.required_native_modules !== undefined) {
    const shell: Record<string, string> = {};
    for (const item of nm.split(",").filter(Boolean)) {
      const i = item.lastIndexOf("@");
      if (i <= 0) return { ok: false, status: 400, error: "bad_request" };
      shell[item.slice(0, i)] = item.slice(i + 1);
    }
    const bad = checkNativeModules(body.required_native_modules, shell);
    if (bad) return { ok: false, status: 404, error: bad.reason, module: bad.module, required: bad.required, ...(bad.have ? { have: bad.have } : {}) };
  }
  if (haltedRelease) {
    let halted: unknown;
    try { halted = JSON.parse(haltedRelease)?.release; } catch { /* corrupt: ignore */ }
    if (halted === body.release) return { ok: false, status: 404, error: "release_halted", release: body.release };
  }
  return { ok: true, release: body.release };
}
