// Ports that Node's fetch (undici) refuses to connect to, even on localhost.
// A readiness poll with fetch never succeeds on these, so tests must not use them.
// This is the WHATWG "bad ports" list that undici applies.
const BLOCKED = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

export const isFetchBlockedPort = (port) => BLOCKED.has(port);

// A random port in [base, base + span) that fetch can reach.
export function pickPort(base, span, random = Math.random) {
  for (;;) {
    const port = base + Math.floor(random() * span);
    if (!isFetchBlockedPort(port)) return port;
  }
}
