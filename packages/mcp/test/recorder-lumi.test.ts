import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Recorder, RecorderError, lumiVoice, voiceCues } from "../src/recorder.js";

const have = (b: string) => spawnSync(b, ["-version"]).status === 0;
const chromium = () => { try { return process.env.SHIPVO_CHROMIUM ?? createRequire(import.meta.url)("playwright").chromium.executablePath(); } catch { return ""; } };
const ok = have("ffmpeg") && have("ffprobe") && !!chromium() && existsSync(chromium());
const html = `<body><span data-part="lumi" id="l">L</span><span data-part="lumi-caption" id="c" hidden></span></body>`;
let srv: http.Server, url = "", out = "";
beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "lumi-"));
  srv = http.createServer((_, r) => { r.writeHead(200, { "content-type": "text/html" }); r.end(html); });
  await new Promise<void>((r) => srv.listen(0, r)); url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/`;
});
afterAll(() => { srv?.close(); rmSync(out, { recursive: true, force: true }); delete process.env.SHIPVO_DIALOGUE; });

describe("voiceCues", () => {
  it("maps step times through the cuts and skips lines that would overlap", () => {
    const steps = [{ at: 1000, text: "Tapping Checkout" }, { at: 1100, text: "Typing" }, { at: 9000, text: "Scrolling down" }, { at: 99000, text: "late" }];
    expect(voiceCues(steps, 0, (ms) => ms - 500, 10)).toEqual([[0.5, "lumi", "Tapping Checkout"], [8.5, "lumi", "Scrolling down"]]);
  });
});

describe("Lumi voice failure", () => {
  it("throws voice_failed when dialogue.py exits non-zero, with the video path", () => {
    const script = join(out, "failing-dialogue.py"); writeFileSync(script, "import sys\nsys.exit('lines overlap; move the later cue')\n");
    process.env.SHIPVO_DIALOGUE = script;
    const file = join(out, "x.mp4");
    try { lumiVoice(file, [[1, "lumi", "Hi"]], 5); expect.unreachable(); }
    catch (e) { expect(e).toBeInstanceOf(RecorderError); expect((e as RecorderError).code).toBe("voice_failed"); expect((e as Error).message).toContain(file); }
    expect(existsSync(file.replace(/\.mp4$/, ".voice"))).toBe(false);
  });
});

describe.skipIf(!ok)("Lumi in recordings", () => {
  it("reports lumi when the frame draws it and when it is turned off", async () => {
    const a = new Recorder(); await a.start({ url, format: "1:1", dir: out, title: "on" });
    await new Promise((x) => setTimeout(x, 600));
    expect((await a.stop()).lumi).toBe(true);
    const b = new Recorder(); await b.start({ url, format: "1:1", dir: out, title: "off", lumi: false });
    await new Promise((x) => setTimeout(x, 600));
    const r = await b.stop(); expect(r.lumi).toBe(false); expect(r.notes).toBeUndefined();
  }, 60000);

  it("keeps the silent video and adds a note when the voice fails", async () => {
    const script = join(out, "exit1.py"); writeFileSync(script, "import sys\nsys.exit(1)\n");
    process.env.SHIPVO_DIALOGUE = script;
    const r = new Recorder(); await r.start({ url, format: "1:1", dir: out, title: "voicefail", lumiVoice: true });
    await new Promise((x) => setTimeout(x, 300));
    await (r as any).page.evaluate(`(() => { const c = document.getElementById("c"); c.hidden = false; c.textContent = "Tapping Checkout"; })()`);
    await new Promise((x) => setTimeout(x, 800));
    const res = await r.stop();
    expect(res.lumi_lines).toBeUndefined();
    expect(res.notes?.some((n) => n.includes("Lumi's voice"))).toBe(true);
    expect(existsSync(res.file)).toBe(true);
  }, 60000);

  it("speaks Lumi's step lines with the energetic preset", async () => {
    const script = join(out, "fake-dialogue.py"), spec = join(out, "spec-copy.json");
    writeFileSync(script, `import json,sys,subprocess\nspec=json.load(open(sys.argv[1]))\nassert spec["cast"]["lumi"]["fx"]=="energetic"\nopen(${JSON.stringify(spec)},"w").write(json.dumps(spec["cues"]))\nsubprocess.check_call(["ffmpeg","-y","-loglevel","error","-f","lavfi","-i","anullsrc=r=48000:cl=mono","-t",sys.argv[3],sys.argv[5]+"/vo.wav"])\n`);
    process.env.SHIPVO_DIALOGUE = script;
    const r = new Recorder(); await r.start({ url, format: "1:1", dir: out, title: "voice", lumiVoice: true });
    await new Promise((x) => setTimeout(x, 300));
    await (r as any).page.evaluate(`(() => { const c = document.getElementById("c"); c.hidden = false; c.textContent = "Tapping Checkout"; })()`);
    await new Promise((x) => setTimeout(x, 800));
    const res = await r.stop();
    expect(res.lumi_lines).toBe(1);
    const a = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_name", "-of", "csv=p=0", res.file], { encoding: "utf8" });
    expect(a.stdout.trim()).toBe("aac");
    expect(existsSync(res.file.replace(/\.mp4$/, ".lumi-voice.wav"))).toBe(false);
    expect(JSON.parse(readFileSync(spec, "utf8"))[0][2]).toBe("Tapping Checkout");
  }, 60000);
});
