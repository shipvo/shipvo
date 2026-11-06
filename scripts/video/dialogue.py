#!/usr/bin/env python3
"""Voices first, then animate: record a film's dialogue and turn each speaker's voice into mouth shapes.

  python3 scripts/video/dialogue.py dialogue.json --total 83 --out build/

dialogue.json:
  {"cast": {"amara": {"voice": "af_heart", "speed": 1.0, "fx": "warm"},
            "lumi":  {"voice": "af_jessica", "speed": 1.1, "fx": "energetic"}},
   "cues": [[1.6, "amara", "Lumi, can you build my app?"], [4.6, "lumi", "Done! You're live!"]]}

Writes to --out:
  vo.wav      every line placed on the timeline (48 kHz mono), ready to mix with the music ducked under it
  mouth.js    `const MOUTH = {who: [level per frame]}`; load it before the film script and draw each mouth
              from MOUTH[who][Math.round(t * fps)]: 0 closed, 1 small, 2 open, 3 wide (anime mouth flaps,
              each shape held at least 2 frames)
  lines.json  start, end and text of every line, for captions and checks
Fails if two lines overlap. Voices come from the keyless Kokoro endpoint; needs ffmpeg (with rubberband) and numpy.
"""
import argparse, json, os, subprocess, sys, time, urllib.parse, urllib.request
import numpy as np

BASE = "https://tts.voice-generator.com"
FX = {  # voice processing presets
    "warm": "acompressor=threshold=-22dB:ratio=3,loudnorm=I=-16",
    "energetic": "rubberband=pitch=1.05:formant=preserved,equalizer=f=3500:t=q:w=1:g=3,"
                 "acompressor=threshold=-22dB:ratio=4:attack=3:release=60,loudnorm=I=-16",
    "plain": "loudnorm=I=-16",
}
TRIM = ("silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
        "silenceremove=start_periods=1:start_threshold=-45dB,areverse")
SR = 48000


def tts(text, voice, speed, out):
    q = urllib.parse.urlencode({"text": text, "voice": voice, "lang": voice[0], "format": "wav", "speed": str(speed)})
    last = ""
    for i in range(4):
        try:
            with urllib.request.urlopen(f"{BASE}/tts?{q}", timeout=180) as r:
                ct, data = r.headers.get("content-type", ""), r.read()
            if ct.startswith("audio/"):  # errors arrive as HTTP 200 + JSON: trust the content type
                open(out, "wb").write(data)
                return
            last = data[:200].decode(errors="replace")
        except Exception as e:
            last = str(e)
        time.sleep(2 * (i + 1))
    sys.exit(f"voice failed for {text!r}: {last}")


def pcm(path):
    raw = subprocess.check_output(["ffmpeg", "-loglevel", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"])
    return np.frombuffer(raw, np.int16) / 32768


def mouth_levels(track, fps):
    hop = SR // fps
    f = len(track) // hop
    rms = np.sqrt(np.mean(track[: f * hop].reshape(f, hop) ** 2, axis=1))
    voiced = rms[rms > 1e-4]
    ref = np.percentile(voiced, 90) if len(voiced) else 1.0
    e = np.convolve(np.clip(rms / ref, 0, 1.2), [.25, .5, .25], "same")
    lv = np.digitize(e, [.12, .35, .7])
    out, hold = [], 0
    for v in lv:  # hold each mouth shape at least 2 frames, as anime does
        if out and hold < 2 and v != out[-1]:
            out.append(out[-1]); hold += 1
        else:
            hold = 1 if (not out or v != out[-1]) else hold + 1
            out.append(int(v))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("spec")
    ap.add_argument("--total", type=float, required=True, help="film length in seconds")
    ap.add_argument("--out", default=".")
    ap.add_argument("--fps", type=int, default=30)
    a = ap.parse_args()
    spec = json.load(open(a.spec))
    os.makedirs(a.out, exist_ok=True)
    n = int(a.total * SR)
    tracks, lines = {}, []
    for i, (t, who, text) in enumerate(spec["cues"]):
        c = spec["cast"][who]
        raw, line = os.path.join(a.out, f"_raw{i:02d}.wav"), os.path.join(a.out, f"_line{i:02d}.wav")
        tts(text, c["voice"], c.get("speed", 1.0), raw)
        fx = FX.get(c.get("fx", "plain"), c.get("fx"))
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", raw, "-af", TRIM + "," + fx, "-ar", str(SR), "-ac", "1", line], check=True)
        x = pcm(line)
        tr = tracks.setdefault(who, np.zeros(n))
        s = int(t * SR)
        tr[s: s + len(x)] += x[: max(0, n - s)]
        lines.append({"start": round(t, 2), "end": round(t + len(x) / SR, 2), "who": who, "text": text})
    bad = [f"{p['who']} at {p['start']}s runs into {q['who']} at {q['start']}s"
           for p, q in zip(lines, lines[1:]) if p["end"] > q["start"]]
    for l in lines:
        print(f"{l['start']:6.2f}-{l['end']:6.2f} {l['who']:>8}: {l['text']}")
    if bad:
        sys.exit("lines overlap; move the later cue: " + "; ".join(bad))
    mouth = {who: mouth_levels(tr, a.fps) for who, tr in tracks.items()}
    open(os.path.join(a.out, "mouth.js"), "w").write("const MOUTH = " + json.dumps(mouth) + ";\n")
    json.dump(lines, open(os.path.join(a.out, "lines.json"), "w"), indent=1)
    mix = sum(tracks.values())
    mix = mix / max(1.0, np.abs(mix).max() / .9)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-",
                    os.path.join(a.out, "vo.wav")], input=(mix * 32767).astype("<i2").tobytes(), check=True)
    print("wrote vo.wav, mouth.js, lines.json;", {k: sum(1 for v in m if v) for k, m in mouth.items()}, "speaking frames")


if __name__ == "__main__":
    main()
