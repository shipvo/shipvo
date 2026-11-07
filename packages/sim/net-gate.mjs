// In-page gate for the phone's network state. Injected into every page the sim serves (addInitScript).
// When the device is offline (network off, airplane mode, Wi-Fi and data off, offline profile), fetch and
// XMLHttpRequest to other origins fail the way they do on a phone: TypeError "Network request failed".
// Latency of slow profiles is not applied here: the session's page route already does that.
// Requests to the sim's own origin are left alone.

export function installNetGate() {
  const g = globalThis;
  if (g.__pnGate) return;
  g.__pnGate = true;
  const online = () => (g.__pnNet ? g.__pnNet.online() : true);
  const outside = (u) => { try { const x = new URL(String(u && u.url ? u.url : u), g.location.href); return (x.protocol === "http:" || x.protocol === "https:") && x.origin !== g.location.origin; } catch { return false; } };
  const origFetch = g.fetch.bind(g);
  g.fetch = function (input, init) {
    if (outside(input) && !online()) return Promise.reject(new TypeError("Network request failed"));
    return origFetch(input, init);
  };
  const X = g.XMLHttpRequest;
  if (X) {
    const open = X.prototype.open, send = X.prototype.send;
    X.prototype.open = function (method, u, ...rest) { this.__gate = outside(u); return open.call(this, method, u, ...rest); };
    X.prototype.send = function (body) {
      if (!this.__gate || online()) return send.call(this, body);
      // Fail like a real network error: DONE with status 0, then error and loadend.
      const x = this;
      setTimeout(() => {
        for (const k of ["readyState", "status"]) Object.defineProperty(x, k, { value: k === "readyState" ? 4 : 0, configurable: true });
        x.dispatchEvent(new Event("readystatechange"));
        x.dispatchEvent(new ProgressEvent("error"));
        x.dispatchEvent(new ProgressEvent("loadend"));
      }, 0);
    };
  }
}
