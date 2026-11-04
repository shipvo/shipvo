import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64, keyFromSeed } from "../src/index";
import { doctor, runDoctorChecks } from "../src/doctor";

const nameOf = (results: Awaited<ReturnType<typeof runDoctorChecks>>, name: string) => results.find((r) => r.name === name)!;
const makeSeed = () => b64(Buffer.alloc(32, 7));
const makePub = (seed: string) => b64(keyFromSeed(seed).publicKey);

function withConfig(body: string, seed?: string) {
  const cwd = mkdtempSync(join(tmpdir(), "shipvo-doctor-"));
  writeFileSync(join(cwd, "shipvo.json"), body);
  if (seed) {
    mkdirSync(join(cwd, ".shipvo"), { recursive: true });
    writeFileSync(join(cwd, ".shipvo", "seed.txt"), seed);
  }
  return cwd;
}

describe("shipvo doctor checks", () => {
  it("passes Node version >= 22 and fails older Node", async () => {
    const seed = makeSeed();
    const cwd = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(seed) }), seed);
    const ok = await runDoctorChecks({ cwd, nodeVersion: "22.11.0", fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    const bad = await runDoctorChecks({ cwd, nodeVersion: "20.11.0", fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    expect(nameOf(ok, "Node version (>=22)").ok).toBe(true);
    expect(nameOf(bad, "Node version (>=22)").ok).toBe(false);
  });

  it("passes and fails when shipvo.json cannot parse", async () => {
    const seed = makeSeed();
    const good = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(seed) }), seed);
    const bad = withConfig("{ bad json", seed);
    const ok = await runDoctorChecks({ cwd: good, fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    const fail = await runDoctorChecks({ cwd: bad, fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    expect(nameOf(ok, "shipvo.json parses").ok).toBe(true);
    expect(nameOf(fail, "shipvo.json parses").ok).toBe(false);
  });

  it("passes and fails signing key match", async () => {
    const seed = makeSeed();
    const good = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(seed) }), seed);
    const bad = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(b64(Buffer.alloc(32, 9))) }), seed);
    const ok = await runDoctorChecks({ cwd: good, fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    const fail = await runDoctorChecks({ cwd: bad, fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    expect(nameOf(ok, "signing key matches shipvo.json publicKey").ok).toBe(true);
    expect(nameOf(fail, "signing key matches shipvo.json publicKey").ok).toBe(false);
  });

  it("passes and fails control plane reachability", async () => {
    const seed = makeSeed();
    const cwd = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(seed) }), seed);
    const ok = await runDoctorChecks({ cwd, fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    const fail = await runDoctorChecks({ cwd, fetchFn: vi.fn(async () => { throw new Error("no route"); }) as typeof fetch });
    expect(nameOf(ok, "control plane reachable").ok).toBe(true);
    expect(nameOf(fail, "control plane reachable").ok).toBe(false);
  });

  it("passes and fails hermesBytecodeVersion when present", async () => {
    const seed = makeSeed();
    const okCwd = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(seed), hermesBytecodeVersion: [96, 98] }), seed);
    const failCwd = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(seed), hermesBytecodeVersion: "nope" }), seed);
    const ok = await runDoctorChecks({ cwd: okCwd, fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    const fail = await runDoctorChecks({ cwd: failCwd, fetchFn: vi.fn(async () => new Response("ok")) as typeof fetch });
    expect(nameOf(ok, "hermesBytecodeVersion (if present) is set").ok).toBe(true);
    expect(nameOf(fail, "hermesBytecodeVersion (if present) is set").ok).toBe(false);
  });

  it("never prints seed or token values", async () => {
    const seed = makeSeed();
    const token = "shipvo-publish-token-value";
    const cwd = withConfig(JSON.stringify({ appId: "a", controlPlane: "https://example.com", publicKey: makePub(b64(Buffer.alloc(32, 9))) }), seed);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => { logs.push(a.join(" ")); });
    vi.spyOn(console, "error").mockImplementation((...a) => { logs.push(a.join(" ")); });
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    vi.stubEnv("SHIPVO_PUBLISH_TOKEN", token);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("ok"));
    const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
    await expect(doctor([])).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);
    expect(logs.join("\n")).not.toContain(seed);
    expect(logs.join("\n")).not.toContain(token);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
});
