// Records one real OTA run for the playground OTA panel and returns it as plain data (written to ota-run.json at build time).
// Signing and verifying use the CLI's signDoc/verifyDoc (Ed25519). Cohort bands come from @shipvo/schema. The crash-loop
// threshold is read from the runtime's own source (BundleSelector.swift and ShipvoHostHandler.kt), so the panel shows the code's number.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const num = (src, re, what) => { const m = src.match(re); if (!m) throw new Error(`playground OTA: could not read ${what}`); return Number(m[1].replace(/_/g, "")); };

export async function recordOtaRun(ROOT) {
  const cli = await import(pathToFileURL(join(ROOT, "packages/cli/dist/index.js")).href);
  const schema = await import(pathToFileURL(join(ROOT, "packages/schema/dist/index.js")).href);

  // Threshold, read from both platforms' runtime code.
  const swift = readFileSync(join(ROOT, "packages/runtime/ios/BundleSelector.swift"), "utf8");
  const kt = readFileSync(join(ROOT, "packages/runtime/android/src/main/java/dev/shipvo/runtime/ShipvoHostHandler.kt"), "utf8");
  const iosMax = num(swift, /static let maxBoots = (\d+)/, "iOS maxBoots"), androidMax = num(kt, /const val MAX_BOOTS = (\d+)/, "Android MAX_BOOTS");
  const iosWin = num(swift, /static let windowSeconds[^=]*= (\d+)/, "iOS windowSeconds"), androidWin = num(kt, /const val WINDOW_MS = ([\d_]+)L/, "Android WINDOW_MS") / 1000;
  if (iosMax !== androidMax || iosWin !== androidWin) throw new Error("playground OTA: Android and iOS crash-loop thresholds differ");
  const maxBoots = iosMax;

  // Signed release, verified with the public key; then the same bytes with one field changed.
  const seed = createHash("sha256").update("shipvo playground demo key, not a real signing key").digest("base64");   // fixed, so the build output is stable
  const publicKey = Buffer.from(cli.keyFromSeed(seed).publicKey).toString("base64");
  const release = { app: "tide-and-tackle", release: 2, text: "v2", bundleSha256: cli.sha256Hex(new TextEncoder().encode("tide-and-tackle bundle v2")), band: "b0" };
  const signed = cli.signDoc(release, seed);
  const signature = { algorithm: "Ed25519", publicKey, signature: signed.signature, valid: cli.verifyDoc(signed, publicKey), tamperedValid: cli.verifyDoc({ ...signed, text: "v2-tampered" }, publicKey) };
  if (!signature.valid || signature.tamperedValid) throw new Error("playground OTA: verifier output is not as expected");

  // Rollout: how many of the 1000 local cohorts each band reaches.
  const counts = { b0: 0, b1: 0, b2: 0 };
  for (let c = 0; c < 1000; c++) counts[schema.bandForCohort(c)]++;
  const reach = (n) => ({ cohorts: n, of: 1000 });
  const stages = [
    { id: "stage", band: "b1", percent: schema.BAND_PERCENT.b1, ...reach(counts.b0 + counts.b1) },
    { id: "widen", band: "b2", percent: schema.BAND_PERCENT.b2, ...reach(counts.b0 + counts.b1 + counts.b2) },
  ];

  // Crash loop: the trial rule from BundleSelector.choose. A start counts as a trial boot; when trialBoots >= maxBoots at the next
  // selection the release is blocked and the previous one returns.
  const boots = []; let trialBoots = 0, reverted = false;
  for (let start = 1; !reverted; start++) {
    if (trialBoots >= maxBoots) { reverted = true; boots.push({ start, running: 1, event: "crash_loop_revert:2" }); }
    else { trialBoots++; boots.push({ start, running: 2, crashed: true, trialBoots }); }
  }
  return { signature, maxBoots, windowSeconds: iosWin, stages, boots, revertAtStart: boots.length, source: ["packages/runtime/ios/BundleSelector.swift", "packages/runtime/android/src/main/java/dev/shipvo/runtime/ShipvoHostHandler.kt"] };
}
