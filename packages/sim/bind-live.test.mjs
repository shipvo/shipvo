// Who can reach the simulator: this machine only by default, another address when --host or SHIPVO_SIM_HOST names one.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickPort } from "./test-port.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;

/** Starts the simulator with `args` and `env`, waits for its first line, and returns { line, stop }. */
function start(port, args = [], env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sim-bind-"));
  const p = spawn(process.execPath, [join(here, "server.mjs"), "--port", String(port), "--dir", dir, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new Error("the simulator did not start")); }, 20000);
    p.stdout.once("data", (d) => { clearTimeout(timer); resolve({ line: String(d).trim(), stop: () => { p.kill("SIGKILL"); rmSync(dir, { recursive: true, force: true }); } }); });
  });
}
// Any HTTP answer counts as reached; a refused connection does not.
const reaches = (host, port) => fetch(`http://${host}:${port}/models`, { method: "POST", body: "{}", signal: AbortSignal.timeout(3000) }).then(() => true, () => false);

test("by default the simulator answers on this machine only", { skip: !lan && "this machine has no network address to test from" }, async () => {
  const port = pickPort(13700, 40), sim = await start(port);
  try {
    assert.match(sim.line, new RegExp(`http://localhost:${port} `));
    assert.equal(await reaches("127.0.0.1", port), true);
    assert.equal(await reaches(lan, port), false);
  } finally { sim.stop(); }
});

test("--host 0.0.0.0 opens the simulator to the network", { skip: !lan && "this machine has no network address to test from" }, async () => {
  const port = pickPort(13740, 40), sim = await start(port, ["--host", "0.0.0.0"]);
  try { assert.equal(await reaches(lan, port), true); assert.equal(await reaches("127.0.0.1", port), true); } finally { sim.stop(); }
});

test("SHIPVO_SIM_HOST sets the address when --host is not given", { skip: !lan && "this machine has no network address to test from" }, async () => {
  const port = pickPort(13780, 40), sim = await start(port, [], { SHIPVO_SIM_HOST: "0.0.0.0" });
  try { assert.equal(await reaches(lan, port), true); } finally { sim.stop(); }
});
