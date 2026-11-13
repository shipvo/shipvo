// Framed captures: the page a screenshot or recording is taken from, and the video encoding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capturePage, contentSize, showShot, shotArgs, concatList, encodeFrames } from "./capture.mjs";
import { SKINS } from "./frame.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("the app area is the screen without the status bar and the bottom bar, on Android and iOS", () => {
  assert.deepEqual(contentSize("android"), { width: 412, height: 915 - SKINS.android.status - SKINS.android.bar });
  assert.deepEqual(contentSize("ios"), { width: 393, height: 852 - SKINS.ios.status - SKINS.ios.bar });
  assert.deepEqual(contentSize("other"), contentSize("android"));
});

test("a frame-sized app gives a phone of the frame's own size, with no Lumi in it", () => {
  for (const skin of ["android", "ios"]) {
    const k = SKINS[skin], c = contentSize(skin), p = capturePage({ skin, ...c, margin: 0 });
    assert.equal(p.width, k.width + k.bezel * 2);
    assert.equal(p.height, k.height + k.bezel * 2);
    assert.ok(!/data-part="lumi"/.test(p.html));
  }
});

for (const skin of ["android", "ios"]) {
  test(`${skin}: the picture sits in the frame at its real size, under a status bar with the given clock`, async () => {
    const b = await chromium.launch();
    try {
      const size = { width: 393, height: 700 };   // not the frame's own size: the phone grows or shrinks around the picture
      const cp = capturePage({ skin, ...size });
      const page = await b.newPage({ viewport: { width: cp.width, height: cp.height } });
      await page.setContent(cp.html);
      const src = await b.newPage({ viewport: size });
      await src.setContent(`<body style="margin:0;background:#0a7"></body>`);
      await page.evaluate(showShot, shotArgs(await src.screenshot(), "image/png", skin, { time: "7:05", airplane: true }));
      const box = (sel) => page.locator(sel).boundingBox();
      const img = await box("#shot"), body = await box('[data-part="phone-body"]'), status = await box('[data-part="status-bar"]'), bar = await box(`[data-part="${SKINS[skin].bottom}"]`);
      assert.deepEqual([img.width, img.height], [size.width, size.height]);
      assert.equal(status.y + status.height, img.y, "the status bar ends where the picture starts");
      assert.equal(img.y + img.height, bar.y, "the bottom bar starts where the picture ends");
      assert.deepEqual([body.x, body.y, body.width, body.height], [24, 24, cp.width - 48, cp.height - 48]);
      assert.equal(await page.textContent('[data-part="time"]'), "7:05");
      assert.equal(await page.locator(`[data-part="${SKINS[skin].part}"]`).count(), 1);
      assert.equal(await page.locator('[data-part="simulated-label"]').count(), 0, "a capture shows the phone alone, with no badge");
    } finally { await b.close(); }
  });
}

for (const skin of ["android", "ios"]) {
  test(`${skin}: the status bar and the bottom bar take the colour of the app's screen, with light marks on a dark screen`, async () => {
    const b = await chromium.launch();
    try {
      const size = { width: 300, height: 500 };
      const cp = capturePage({ skin, ...size });
      const page = await b.newPage({ viewport: { width: cp.width, height: cp.height } });
      await page.setContent(cp.html);
      const src = await b.newPage({ viewport: size });
      const look = async (appCss) => {
        await src.setContent(`<body style="margin:0;${appCss}"></body>`);
        await page.evaluate(showShot, shotArgs(await src.screenshot(), "image/png", skin, {}));
        return page.evaluate((bottomPart) => {
          const cs = (sel) => getComputedStyle(document.querySelector(sel));
          return { statusBg: cs('[data-part="status-bar"]').backgroundColor, statusFg: cs('[data-part="status-bar"]').color, barBg: cs(`[data-part="${bottomPart}"]`).backgroundColor, markBg: cs(`[data-part="${bottomPart}"] i`).backgroundColor };
        }, SKINS[skin].bottom);
      };
      assert.deepEqual(await look("background:#101418"), { statusBg: "rgb(16, 20, 24)", statusFg: "rgb(255, 255, 255)", barBg: "rgb(16, 20, 24)", markBg: "rgb(255, 255, 255)" });
      assert.deepEqual(await look("background:#ffffff"), { statusBg: "rgb(255, 255, 255)", statusFg: "rgb(17, 17, 17)", barBg: "rgb(255, 255, 255)", markBg: "rgb(17, 17, 17)" });
      // A dark header over a light page: the top follows the header, the bottom follows the page.
      const mixed = await look("background:linear-gradient(#0a2a4a 0 40px,#fafafa 40px)");
      assert.equal(mixed.statusFg, "rgb(255, 255, 255)"); assert.equal(mixed.markBg, "rgb(17, 17, 17)");
    } finally { await b.close(); }
  });
}

test("the status bar icons are in the platform's order: Wi-Fi first on Android, signal first on iOS", () => {
  const order = (skin) => [...shotArgs(Buffer.from("x"), "image/png", skin, {})[2].matchAll(/data-part="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(order("android"), ["wifi", "signal", "battery"]);
  assert.deepEqual(order("ios"), ["signal", "wifi", "battery"]);
});

test("the concat list shows each frame until the next one and the last until the end", () => {
  assert.equal(concatList([1000, 1250, 2000], 2600), "file '0.jpg'\nduration 0.250\nfile '1.jpg'\nduration 0.750\nfile '2.jpg'\nduration 0.600\nfile '2.jpg'\n");
});

test("encoding reports no_frames, no_ffmpeg and encode_failed by code", async () => {
  const code = (p) => p.then(() => "none", (e) => e.code);
  const dir = () => mkdtempSync(join(tmpdir(), "cap-"));
  assert.equal(await code(encodeFrames({ dir: dir(), times: [], end: 1, out: "x.mp4" })), "no_frames");
  const fake = (how) => () => { const ff = new EventEmitter(); ff.stderr = new EventEmitter(); setImmediate(() => how(ff)); return ff; };
  assert.equal(await code(encodeFrames({ dir: dir(), times: [1], end: 2, out: "x.mp4", run: fake((ff) => ff.emit("error", new Error("ENOENT"))) })), "no_ffmpeg");
  assert.equal(await code(encodeFrames({ dir: dir(), times: [1], end: 2, out: "x.mp4", run: fake((ff) => ff.emit("close", 1)) })), "encode_failed");
});

test("frames become an MP4 as long as the recording, and the frames are removed", { skip: !hasFfmpeg && "ffmpeg is not installed" }, async () => {
  const b = await chromium.launch();
  const dir = mkdtempSync(join(tmpdir(), "cap-")), out = join(dir, "..", `cap-${Date.now()}.mp4`);
  try {
    const page = await b.newPage({ viewport: { width: 101, height: 201 } });   // odd sizes: the encoder needs even ones
    for (let i = 0; i < 3; i++) { await page.setContent(`<body style="background:hsl(${i * 90},80%,50%)"></body>`); writeFileSync(join(dir, `${i}.jpg`), await page.screenshot({ type: "jpeg" })); }
    const r = await encodeFrames({ dir, times: [0, 400, 800], end: 1500, out });
    assert.deepEqual(r, { path: out, duration_s: 1.5, frames: 3 });
    assert.ok(statSync(out).size > 500);
    assert.equal(existsSync(dir), false);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=width,height", "-of", "csv=p=0", out], { encoding: "utf8" });
    if (probe.status === 0) { const [wh, dur] = probe.stdout.trim().split("\n"); assert.equal(wh, "100,200"); assert.ok(Math.abs(Number(dur) - 1.5) < 0.1, `duration ${dur}`); }
  } finally { await b.close(); }
});
