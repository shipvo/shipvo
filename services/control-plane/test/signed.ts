import app from "../src/index";
import { canonicalize } from "@shipvo/schema";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export async function hmacHex(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
}
let n = 0;
const rand = (len: number) => { n++; return (n.toString(16).padStart(8, "0") + Math.random().toString(16).slice(2).padEnd(60, "a")).repeat(2).slice(0, len); };

/** Register a fresh install through the real route and return a function that sends signed reports. */
export async function newInstall(env: any, appId = "tide", ip = "203.0.113.7", shell = "1.0.0") {
  const install_id = rand(32), install_key = rand(64);
  const r = await app.request("/t/register", { method: "POST", headers: { "cf-connecting-ip": ip }, body: JSON.stringify({ schema_version: "1.0", app_id: appId, install_id, install_key, shell_version: shell }) }, env);
  if (r.status !== 200) throw new Error(`register failed: ${r.status}`);
  const { install_token } = (await r.json()) as any;
  let seq = 0;
  const sign = async (report: Record<string, unknown>) => {
    const body = { ...report, install_id, install_token, n: ++seq }; // n keeps repeated reports from being replays
    return { ...body, sig: await hmacHex(install_key, canonicalize(body)) };
  };
  const send = async (report: Record<string, unknown>, fromIp = ip) =>
    app.request("/t", { method: "POST", headers: { "cf-connecting-ip": fromIp }, body: JSON.stringify(await sign(report)) }, env);
  const sendWith = async (report: Record<string, unknown>, ctx?: any) =>
    app.request("/t", { method: "POST", headers: { "cf-connecting-ip": ip }, body: JSON.stringify(await sign(report)) }, env, ctx);
  return { sendWith, install_id, install_key, install_token, sign, send };
}
