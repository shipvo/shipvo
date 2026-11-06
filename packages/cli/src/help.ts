export const COMMANDS = [
  "init", "sim", "run", "explore", "preview", "publish", "promote", "auto-halt", "rollback", "app", "eas", "login", "doctor", "store", "ci", "status", "agents", "audit", "test", "keys", "mcp",
  "keygen", "pubkey", "hash", "sign-file", "sign-json", "verify-json", "verify",
] as const;

export const help = `shipvo <command>

Start
  init <dir>                  Create a new app wired to Shipvo
  sim [--port 4545]           Build the app and run it in the simulator
  sim --watch [--verbose]     Rebuild on file changes and keep serving; --verbose shows full build errors
                              First run installs playwright and, if no Chrome or Edge is found, downloads Chromium once.
                              Set SHIPVO_NO_AUTO_INSTALL=1 to turn the automatic installs off.
  run android|ios [--no-open] [--port n]  Open the app in a phone frame in your browser (no Playwright)
  run android|ios --native    Run on an emulator or simulator with npx expo run:android / run:ios
  explore [--max-depth 3] [--max-steps 100] [--fail-on-findings]  Walk the app in the simulator, write explore-report.md and .json
  preview [--json]            Publish a public 24-hour preview link (here.now, no account)

Ship
  publish [--bands b0,b1,b2] [--release N]  Build, sign and publish an over-the-air release
  publish --dry-run [--out d] Check a release offline: build and sign, write nothing remote
  promote [--to b1,b2]        Widen a staged release to more bands (same release, new signature)
  promote --dry-run           Preview a promote, write nothing
  promote --report <file>     Refuse to widen when the test report has a failing flow for this release
  auto-halt [--threshold 0.2 --min-reports 20 | --off]  Show, turn on or turn off auto-halt
  rollback --to <release>     Republish an earlier release as a new release
  rollback --to <n> --dry-run Preview a rollback, write nothing
  app create | list | delete  Register, list or remove apps on the hosted control plane
  eas setup [--dry-run] [--run]  Make a Capacitor repo ready for eas build and submit (your own Expo account)
  eas build [args]            Link the iOS scheme, then run eas build
  login                       Sign in with GitHub and get a key for the hosted simulator
  store details --dry-run     Draft Play Data safety answers and a privacy policy from shipvo.json
  store setup [--company yes|no] [--android-now] [--play-account-before-2023-11-13]
                              Pick the store accounts to open and write store-plan.json
  store screenshots [--out dir] [--sim url]
                              Render each route at store sizes (fast mode: simulator, not the native UI)
  store testers [--package id] [--track alpha] [--play-key file] [--json]
                              Steps to get your 12 testers; add the Shipvo Testers group to the closed track
  store status [--mark <step> [--as waiting|done]]
                              Show each store's steps and what to do next
  ci init --framework capacitor [--dry-run] [--force]
                              Write .github/workflows/shipvo-build.yml (signed Android and iOS builds)
  status [--app id] [--json]  Show how the newest releases are doing on phones; --json gives agents the next steps (exit 0 ok, 1 action needed, 2 error)
  agents setup [--dry-run] [--json]  Write the Shipvo section of AGENTS.md and add @shipvo/mcp to .mcp.json
  audit <app> [--format json|csv] [--limit n]  Export the audit log to stdout
  test [files] [--repair [--write]] [--report <file> [--release <id>]]  Run tests/*.steps; --repair shows a diff for broken steps, --write saves it; --report writes JSON results keyed by commit and release
  doctor [--port <n>]         Check setup before first publish
  keys                        Show the stored key's status and quota
  keys export [--out f]       Print or save this app's signing seed, to back it up
  keys import [seed|--file f] Restore the signing seed on a new machine
  mcp                         Print the MCP config that agents need

Advanced
  keygen [--out seed.txt]     Create an Ed25519 signing key and print the public key
  pubkey                      Print the public key for SHIPVO_SIGNING_SEED
  hash <file>                 Print the SHA-256 and size of a file
  sign-file <file>            Print the Ed25519 signature (base64) of a file
  sign-json <file.json>       Sign a JSON document and write the signature into it
  verify <pointer> [public-key-b64]
                              Check a release pointer (such as one from publish --dry-run)
  verify-json <file.json> <public-key-b64>
                              Check the signature of a JSON document
`;

export function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Closest command within edit distance 2, or undefined. */
export function suggest(input: string): string | undefined {
  let best: string | undefined;
  let bestD = 3;
  for (const c of COMMANDS) {
    const d = distance(input.toLowerCase(), c);
    if (d < bestD) { best = c; bestD = d; }
  }
  return best;
}

export function unknownCommand(input: string): string {
  const s = suggest(input);
  return `shipvo: '${input}' is not a command.${s ? ` Did you mean '${s}'?` : ""}\nRun 'shipvo --help' to see all commands.\n`;
}

/** What to print when a command throws: the message, not a stack trace. Set SHIPVO_DEBUG=1 for the stack. */
export function failure(e: unknown, debug = !!process.env.SHIPVO_DEBUG): string {
  if (debug && e instanceof Error && e.stack) return e.stack;
  const m = e instanceof Error ? e.message : String(e);
  return `shipvo: ${m}\nRun 'shipvo doctor' to check your setup, or set SHIPVO_DEBUG=1 to see the full error.\n`;
}
