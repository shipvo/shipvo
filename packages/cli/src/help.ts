export const COMMANDS = [
  "init", "sim", "publish", "rollback", "app", "login", "keys", "mcp",
  "keygen", "pubkey", "hash", "sign-file", "sign-json", "verify-json",
] as const;

export const help = `shipvo <command>

Start
  init <dir>                  Create a new app wired to Shipvo
  sim [--port 4545]           Build the app and run it in the simulator

Ship
  publish [--bands b0,b1,b2]  Build, sign and publish an over-the-air release
  publish --dry-run [--out d] Build and sign offline, write to a local directory (default .shipvo/dry-run)
  rollback --to <release>     Republish an earlier release as a new release
  app create | list | delete  Register, list or remove apps on the hosted control plane
  login                       Sign in with GitHub and get a key for the hosted simulator
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
