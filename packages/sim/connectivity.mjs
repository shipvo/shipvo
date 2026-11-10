// Connectivity: Wi-Fi, mobile data and airplane mode, and the network state apps read from them.
// Airplane mode turns both radios off; Wi-Fi can be turned back on while it is on, and then the phone is online, as on Android and iOS.
// Turning airplane mode off brings the radios back as they were before.

export class ConnectivityError extends Error { constructor(code, message) { super(message); this.code = code; } }

export const initialConnectivity = () => ({ wifi: true, mobile_data: true, airplane: false });

/** The state after a change. `patch` may hold wifi, mobile_data and airplane (booleans). */
export function applyConnectivity(cur, patch = {}) {
  const keys = ["wifi", "mobile_data", "airplane"];
  const given = keys.filter((k) => patch[k] !== undefined);
  if (!given.length) throw new ConnectivityError("bad_value", "give at least one of wifi, mobile_data, airplane");
  for (const k of given) if (typeof patch[k] !== "boolean") throw new ConnectivityError("bad_value", `${k} takes true or false`);
  const next = { ...cur };
  if (patch.airplane === true && !cur.airplane) { next.before = { wifi: cur.wifi, mobile_data: cur.mobile_data }; next.airplane = true; next.wifi = false; next.mobile_data = false; }
  if (patch.airplane === false && cur.airplane) { next.airplane = false; Object.assign(next, cur.before ?? { wifi: true, mobile_data: true }); delete next.before; }
  if (patch.wifi !== undefined) next.wifi = patch.wifi;
  if (patch.mobile_data !== undefined) { if (next.airplane && patch.mobile_data) throw new ConnectivityError("airplane_on", "mobile data stays off in airplane mode; turn airplane mode off first"); next.mobile_data = patch.mobile_data; }
  return next;
}

/** What apps read: online and the connection type (wifi, cellular or none). An "offline" network profile also means no network. */
export function networkOf(c, profile = "online") {
  const online = profile !== "offline" && (c.wifi || (!c.airplane && c.mobile_data));
  return { online, type: !online ? "none" : c.wifi ? "wifi" : "cellular" };
}

/** The public view: the three switches plus the network apps see. */
export const describeConnectivity = (c, profile) => ({ wifi: c.wifi, mobile_data: c.mobile_data, airplane: c.airplane, ...networkOf(c, profile) });
