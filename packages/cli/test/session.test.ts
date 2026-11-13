import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { session, projectInfo, type SessionDeps } from "../src/session";

/** An Expo app folder with no shipvo.json, and deps that stand in for the build, the browser and the simulator. */
function setup(pkg: object = { name: "My Shop", dependencies: { expo: "55", "react-native-web": "1", "react-dom": "19", "@expo/metro-runtime": "5" } }) {
  const root = mkdtempSync(join(tmpdir(), "shipvo-session-"));
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
  const state = { now: Date.parse("2026-11-13T10:00:00Z"), alive: new Set<number>(), killed: [] as number[], builds: 0, posts: [] as { path: string; body: any }[], watchdog: 0, watched: null as null | { port: number; id: string }, reply: {} as Record<string, object> };
  const deps: SessionDeps = {
    root, now: () => state.now,
    build: async () => { state.builds++; },
    resolveServer: () => "/sim/server.mjs",
    models: async () => ({
      models: [
        { name: "Pixel 8", platform: "android", width: 412, height: 915, scale: 2.625 },
        { name: "Galaxy S24", platform: "android", width: 360, height: 780, scale: 3 },
        { name: "iPhone 16", platform: "ios", width: 393, height: 852, scale: 3 },
        { name: "iPhone 16 Pro", platform: "ios", width: 402, height: 874, scale: 3 },
      ],
      defaults: { android: "Pixel 8", ios: "iPhone 16" },
    }),
    ensureBrowser: () => undefined,
    freePort: async () => 5123,
    startServer: async () => { state.alive.add(900); return 900; },
    startWatchdog: (_pid, ms, o) => { state.watchdog = ms; state.watched = o; state.alive.add(901); return 901; },
    alive: (pid) => state.alive.has(pid),
    kill: (pid) => { state.killed.push(pid); state.alive.delete(pid); },
    fetch: (async (url: string, init: { body: string }) => {
      const path = new URL(url).pathname; const body = JSON.parse(init.body);
      state.posts.push({ path, body });
      const shot = join(root, ".shipvo", "sessions", body.session, "shot-1.png");
      if (body.action === "screenshot") writeFileSync(shot, "png");
      const video = join(root, ".shipvo", "sessions", body.session, "rec-1.mp4");
      if (body.action === "record_stop" && !state.reply.record_stop) { writeFileSync(video, "mp4"); return new Response(JSON.stringify({ ok: true, path: video, duration_s: 4.2, frames: 30, screen: "" })); }
      return new Response(JSON.stringify(state.reply[body.action ?? "session"] ?? { ok: true, screen: '- button "Buy" [ref=e1]', ...(body.action === "screenshot" ? { path: shot } : {}), ...(body.action === "type" ? { value: body.text } : {}) }));
    }) as unknown as typeof fetch,
  };
  return { root, deps, state };
}

async function run(deps: SessionDeps, argv: string[]) {
  const out: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.map(String).join(" ")); });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const exit = await session([...argv, "--json"], deps);
  vi.restoreAllMocks();
  expect(out).toHaveLength(1);
  const doc = JSON.parse(out[0]);
  expect(doc.ok).toBe(exit === 0);
  return { doc, exit };
}
afterEach(() => vi.restoreAllMocks());

describe("shipvo session", () => {
  it("starts a phone for an Expo app that has no shipvo.json", async () => {
    const { deps, state, root } = setup();
    const { doc, exit } = await run(deps, ["start", "ios", "--max-duration-minutes", "20"]);
    expect(exit).toBe(0); expect(doc.code).toBe("started");
    expect(doc.data).toMatchObject({ app: "my-shop", platform: "ios", device: "iPhone 16", status: "in_progress", port: 5123, url: "http://127.0.0.1:5123", expires_at: "2026-11-13T10:20:00.000Z", mcp_env: { PN_SIM: "http://127.0.0.1:5123" } });
    expect(doc.data.id).toMatch(/^ios-[0-9a-f]{8}$/);
    expect(doc.data.screen).toContain("[ref=e1]");
    expect(state.builds).toBe(1);
    expect(state.watchdog).toBe(20 * 60_000);
    expect(state.watched).toEqual({ port: 5123, id: doc.data.id });
    expect(state.posts[0]).toEqual({ path: "/session", body: { session: doc.data.id, app: "my-shop", model: "iPhone 16" } });
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain(".shipvo/");
  });

  it("defaults to Android, the Pixel 8 and 30 minutes", async () => {
    const { deps, state } = setup();
    const { doc } = await run(deps, ["start"]);
    expect(doc.data.platform).toBe("android");
    expect(doc.data.device).toBe("Pixel 8");
    expect(doc.summary).toContain("simulated Pixel 8");
    expect(state.watchdog).toBe(30 * 60_000);
  });

  it("--device starts that phone model, and the model decides the platform", async () => {
    const { deps, state } = setup();
    const { doc } = await run(deps, ["start", "--device", "  iphone 16  pro "]);
    expect(doc.data).toMatchObject({ platform: "ios", device: "iPhone 16 Pro" });
    expect(doc.data.id).toMatch(/^ios-/);
    expect(state.posts[0].body.model).toBe("iPhone 16 Pro");
    expect((await run(deps, ["start", "android", "--device", "Galaxy S24"])).doc.data.device).toBe("Galaxy S24");
  });

  it("refuses an unknown model, and a model that is not the platform asked for", async () => {
    const { deps, state } = setup();
    const unknown = await run(deps, ["start", "--device", "Nokia 3310"]);
    expect(unknown.exit).toBe(2); expect(unknown.doc.code).toBe("bad_model");
    expect(unknown.doc.next[0].command).toBe("shipvo session devices --json");
    const wrong = await run(deps, ["start", "android", "--device", "iPhone 16"]);
    expect(wrong.exit).toBe(2); expect(wrong.doc.summary).toContain("iPhone 16 is an iOS phone");
    expect(state.builds).toBe(0);
  });

  it("an app that uses expo-router is opened at its own root route", async () => {
    const withRouter = setup({ name: "shop", dependencies: { expo: "55", "expo-router": "6", "react-native-web": "1", "react-dom": "19", "@expo/metro-runtime": "5" } });
    await run(withRouter.deps, ["start"]);
    expect(withRouter.state.posts[0].body.root_mount).toBe(true);
    const plain = setup();
    await run(plain.deps, ["start"]);
    expect("root_mount" in plain.state.posts[0].body).toBe(false);
  });

  it("devices lists the phone models with their screen size and the defaults", async () => {
    const { deps } = setup();
    const { doc, exit } = await run(deps, ["devices"]);
    expect(exit).toBe(0);
    expect(doc.data.devices).toHaveLength(4);
    expect(doc.data.devices[2]).toEqual({ name: "iPhone 16", platform: "ios", width: 393, height: 852, scale: 3 });
    expect(doc.data.defaults).toEqual({ android: "Pixel 8", ios: "iPhone 16" });
  });

  it("names the web packages an app is missing and how to add them", async () => {
    const { deps, state } = setup({ name: "x", dependencies: { expo: "55", "react-dom": "19" } });
    const { doc, exit } = await run(deps, ["start"]);
    expect(exit).toBe(1); expect(doc.code).toBe("web_deps_missing");
    expect(doc.next[0].command).toBe("npx expo install react-native-web @expo/metro-runtime");
    expect(state.builds).toBe(0);
  });

  it("a web package the app does not list but has installed is not reported as missing", async () => {
    const { deps, state, root } = setup({ name: "game", dependencies: { expo: "55", "expo-router": "6", "react-native-web": "1", "react-dom": "19" } });
    mkdirSync(join(root, "node_modules", "@expo", "metro-runtime"), { recursive: true });
    writeFileSync(join(root, "node_modules", "@expo", "metro-runtime", "package.json"), JSON.stringify({ name: "@expo/metro-runtime", version: "6.0.0" }));
    const { doc, exit } = await run(deps, ["start"]);
    expect(exit).toBe(0); expect(doc.code).toBe("started");
    expect(state.builds).toBe(1);
  });

  it("an app on an Expo version older than 49 is not asked for @expo/metro-runtime", async () => {
    const { deps, state } = setup({ name: "conf", dependencies: { expo: "^48.0.0", "react-native-web": "~0.18.7", "react-dom": "18.2.0" } });
    const { doc } = await run(deps, ["start"]);
    expect(doc.code).toBe("started");
    expect(state.builds).toBe(1);
  });

  it("refuses a folder that is not an Expo app", async () => {
    const { deps } = setup({ name: "x", dependencies: { react: "19" } });
    const { doc, exit } = await run(deps, ["start"]);
    expect(exit).toBe(2); expect(doc.code).toBe("not_expo");
  });

  it("stops the simulator when the app does not open", async () => {
    const { deps, state } = setup();
    state.reply.session = { ok: false, code: "bad_app", error: "no such app" };
    const { doc, exit } = await run(deps, ["start"]);
    expect(exit).toBe(1); expect(doc.code).toBe("bad_app");
    expect(state.killed).toEqual([900]);
    expect((await run(deps, ["list"])).doc.data.sessions).toEqual([]);
  });

  it("drives the newest running session: screen, tap, type, scroll, back", async () => {
    const { deps, state } = setup();
    const id = (await run(deps, ["start"])).doc.data.id;
    expect((await run(deps, ["screen"])).doc.data.screen).toContain("Buy");
    await run(deps, ["tap", "e1"]);
    expect((await run(deps, ["type", "e2", "hello", "there"])).doc.data.value).toBe("hello there");
    await run(deps, ["scroll", "down", "e3"]);
    await run(deps, ["back"]);
    expect(state.posts.slice(1).map((p) => p.body)).toEqual([
      { session: id, action: "screen" }, { session: id, action: "tap", ref: "e1" }, { session: id, action: "type", ref: "e2", text: "hello there" },
      { session: id, action: "scroll", direction: "down", ref: "e3" }, { session: id, action: "back" },
    ]);
  });

  it("passes on the simulator's error code when an action fails", async () => {
    const { deps, state } = setup();
    await run(deps, ["start"]);
    state.reply.tap = { ok: false, code: "stale_ref", error: "ref e9 is not on the screen" };
    const { doc, exit } = await run(deps, ["tap", "e9"]);
    expect(exit).toBe(1); expect(doc.code).toBe("stale_ref");
    expect(doc.next[0].command).toContain("session screen");
  });

  it("screenshots the whole phone in its frame unless --no-frame is given", async () => {
    const { deps, state } = setup();
    await run(deps, ["start"]);
    await run(deps, ["screenshot"]);
    await run(deps, ["screenshot", "--no-frame"]);
    expect(state.posts.slice(1).map((p) => p.body.frame)).toEqual([true, false]);
  });

  it("records a video: record start, then record stop saves it and lists it as an artifact", async () => {
    const { deps, state, root } = setup();
    const id = (await run(deps, ["start"])).doc.data.id;
    const started = await run(deps, ["record", "start"]);
    expect(started.doc.code).toBe("recording");
    expect(started.doc.next[0].command).toBe(`shipvo session record stop --id ${id} --json`);
    const { doc } = await run(deps, ["record", "stop", "--out", "videos/run.mp4"]);
    expect(doc.code).toBe("recorded");
    expect(doc.data).toEqual({ session: id, path: join(root, "videos", "run.mp4"), duration_s: 4.2, frames: 30 });
    expect(existsSync(join(root, "videos", "run.mp4"))).toBe(true);
    expect(state.posts.slice(1).map((p) => p.body.action)).toEqual(["record_start", "record_stop"]);
    expect((await run(deps, ["get"])).doc.data.artifacts.map((a: { name: string }) => a.name)).toEqual(["rec-1.mp4"]);
    state.reply.record_stop = { ok: false, code: "no_recording", error: "no recording is running" };
    expect((await run(deps, ["record", "stop"])).doc.code).toBe("no_recording");
    expect((await run(deps, ["record", "pause"])).exit).toBe(2);
  });

  it("stop saves a recording that is still running before it ends the simulator", async () => {
    const { deps, state } = setup();
    const id = (await run(deps, ["start"])).doc.data.id;
    await run(deps, ["record", "start"]);
    const { doc } = await run(deps, ["stop"]);
    expect(state.posts.at(-1)!.body).toEqual({ session: id, action: "record_stop" });
    expect(state.killed).toEqual([900, 901]);
    expect(doc.data.artifacts.map((a: { name: string }) => a.name)).toEqual(["rec-1.mp4"]);
  });

  it("saves a screenshot, copies it to --out and lists it as an artifact", async () => {
    const { deps, root } = setup();
    const id = (await run(deps, ["start"])).doc.data.id;
    const { doc } = await run(deps, ["screenshot", "--out", "shots/home.png"]);
    expect(doc.data.path).toBe(join(root, "shots", "home.png"));
    expect(existsSync(join(root, "shots", "home.png"))).toBe(true);
    expect((await run(deps, ["get", "--id", id])).doc.data.artifacts).toEqual([{ name: "shot-1.png", path: join(root, ".shipvo", "sessions", id, "shot-1.png") }]);
  });

  it("stop ends the simulator and its timer, and is safe to repeat", async () => {
    const { deps, state } = setup();
    const id = (await run(deps, ["start"])).doc.data.id;
    const first = await run(deps, ["stop", "--id", id]);
    expect(first.doc.data).toMatchObject({ status: "stopped", stop_reason: "stopped" });
    expect(state.killed).toEqual([900, 901]);
    expect((await run(deps, ["stop", "--id", id])).exit).toBe(0);
    expect(state.killed).toHaveLength(2);
    const after = await run(deps, ["tap", "e1", "--id", id]);
    expect(after.doc.code).toBe("session_stopped");
  });

  it("reports a session that reached its time limit as expired", async () => {
    const { deps, state } = setup();
    const id = (await run(deps, ["start", "--max-duration-minutes", "5"])).doc.data.id;
    state.alive.clear(); state.now += 6 * 60_000;
    const { doc } = await run(deps, ["get", "--id", id]);
    expect(doc.data).toMatchObject({ status: "stopped", stop_reason: "expired", stopped_at: "2026-11-13T10:05:00.000Z" });
    expect((await run(deps, ["screen"])).doc.code).toBe("no_session");
  });

  it("rejects bad input with exit 2", async () => {
    const { deps } = setup();
    expect((await run(deps, ["start", "windows"])).exit).toBe(2);
    expect((await run(deps, ["start", "--max-duration-minutes", "0"])).exit).toBe(2);
    expect((await run(deps, ["dance"])).exit).toBe(2);
    await run(deps, ["start"]);
    expect((await run(deps, ["scroll", "sideways"])).exit).toBe(2);
    expect((await run(deps, ["tap"])).exit).toBe(2);
    expect((await run(deps, ["get", "--id", "../x"])).doc.code).toBe("no_session");
  });
});

describe("projectInfo", () => {
  it("prefers shipvo.json, then app.json, then package.json", () => {
    const { root } = setup();
    expect(projectInfo(root)).toMatchObject({ app: "my-shop", name: "My Shop", missingWebDeps: [] });
    writeFileSync(join(root, "app.json"), JSON.stringify({ expo: { slug: "shop_app", name: "Shop" } }));
    expect(projectInfo(root)).toMatchObject({ app: "shop-app", name: "Shop" });
    writeFileSync(join(root, "shipvo.json"), JSON.stringify({ appId: "tide", name: "Tide" }));
    expect(projectInfo(root)).toMatchObject({ app: "tide", name: "Tide" });
  });
});
