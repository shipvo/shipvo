// Ports that Node's fetch (undici) refuses to connect to, even on localhost.
// A readiness poll with fetch never succeeds on these, so tests must not use them.
const BLOCKED = new Set([5060, 5061]);

export const isFetchBlockedPort = (port) => BLOCKED.has(port);

// A random port in [base, base + span) that fetch can reach.
export function pickPort(base, span, random = Math.random) {
  for (;;) {
    const port = base + Math.floor(random() * span);
    if (!isFetchBlockedPort(port)) return port;
  }
}
