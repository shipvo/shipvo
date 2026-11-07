// In-page gate for the phone's network state. Injected into every page the sim serves (addInitScript).
// When the device is offline (network off, airplane mode, Wi-Fi and data off, offline profile), fetch and
// XMLHttpRequest to other origins fail the way they do on a phone: TypeError "Network request failed".
// A slow device profile adds its latency. Requests to the sim's own origin are left alone.
import { PROFILES } from "./network-profiles.mjs";

function gate(profiles) {
  const g = globalThis;
  if (g.__pnGate) return;
  g.__pnGate = true;
  const state = () => ({ online: g.__pnNet ? g.__pnNet.online() : true, profile: g.__pnNet ? g.__pnNet.profile() : "online" });
  const outside = (u) => { try { const x = new URL(String(u && u.url ? u.url : u), g.location.href); return (x.protocol === "http:" || x.protocol === "https:") && x.origin !== g.location.origin; } catch { return false; } };
  const delay = () => { const p = profiles[state().profile]; return p && p.latencyMs > 0 ? p.latencyMs : 0; };
  const origFetch = g.fetch.bind(g);
  g.fetch = async function (input, init) {
    if (!outside(input)) return origFetch(input, init);
    if (!state().online) throw new TypeError("Network request failed");
    const ms = delay();
    if (ms) await new Promise((r) => setTimeout(r, ms));
    if (!state().online) throw new TypeError("Network request failed");
    return origFetch(input, init);
  };
  const X = g.XMLHttpRequest;
  if (X) {
    const open = X.prototype.open, send = X.prototype.send;
    X.prototype.open = function (method, u, ...rest) { this.__gate = outside(u); return open.call(this, method, u, ...rest); };
    X.prototype.send = function (body) {
      if (!this.__gate) return send.call(this, body);
      if (!state().online) { setTimeout(() => this.dispatchEvent(new ProgressEvent("error")), 0); return; }
      const ms = delay();
      if (ms) { setTimeout(() => send.call(this, body), ms); return; }
      return send.call(this, body);
    };
  }
}

export const netGateProfiles = Object.fromEntries(Object.entries(PROFILES).map(([k, v]) => [k, { latencyMs: v.latencyMs }]));
export const installNetGate = gate;
