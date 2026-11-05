#!/usr/bin/env python3
"""narrate_hosted.py — Kokoro narration via the hosted keyless endpoint."""
import argparse, json, os, subprocess, sys, tempfile, time, urllib.error, urllib.parse, urllib.request

BASE = "https://tts.voice-generator.com"

def lang_for(voice):  # lang is the first letter of the voice id
    return voice[0] if voice[:1] in "abjzefhip" else "a"

def check(text, lang):
    q = urllib.parse.urlencode({"text": text, "lang": lang})
    with urllib.request.urlopen(f"{BASE}/check?{q}", timeout=60) as r:
        return json.load(r)

def fetch(text, voice, speed, out, tries=6):
    q = urllib.parse.urlencode({"text": text, "voice": voice, "lang": lang_for(voice), "format": "wav", "speed": str(speed)})
    last = None
    for i in range(tries):
        limited = False
        try:
            with urllib.request.urlopen(f"{BASE}/tts?{q}", timeout=180) as r:
                ct, data = r.headers.get("content-type", ""), r.read()
            if ct.startswith("audio/"):  # errors arrive as HTTP 200 + JSON: trust the content type
                open(out, "wb").write(data); return
            last = data[:200].decode(errors="replace")
        except urllib.error.HTTPError as e:
            last, limited = str(e), e.code == 429
        except Exception as e:
            last = str(e)
        time.sleep(2 * (i + 1) * (5 if limited else 1))
    raise SystemExit(f"TTS failed after {tries} tries: {last}")

def dur(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--text"); ap.add_argument("--file")
    ap.add_argument("--voice", default="bm_fable")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--pause", type=float, default=0.35)
    ap.add_argument("--out", default="narration.wav")
    ap.add_argument("--manifest")
    a = ap.parse_args()
    raw = open(a.file, encoding="utf-8").read() if a.file else a.text
    if not raw: raise SystemExit("Provide --text or --file.")
    segs = [s.strip() for s in raw.split("\n\n") if s.strip()]
    lang = lang_for(a.voice)
    for i, s in enumerate(segs):  # ~510-token cap per request
        c = check(s, lang)
        if c.get("exceeds_limit"):
            raise SystemExit(f"segment {i} is {c.get('token_count')} tokens (max {c.get('max_tokens')}); split it with a blank line")
    tmp = tempfile.mkdtemp(prefix="kokoro-"); parts, man, t = [], [], 0.0
    for i, s in enumerate(segs):
        p = os.path.join(tmp, f"seg{i:03d}.wav"); fetch(s, a.voice, a.speed, p)
        d = dur(p); man.append({"index": i, "start": round(t, 3), "end": round(t + d, 3), "duration": round(d, 3), "text": s})
        parts.append(p); t += d + a.pause
        print(f"  seg {i:03d}  {d:6.2f}s  {s[:60]}", file=sys.stderr)
    args, n = ["ffmpeg", "-y", "-loglevel", "error"], 0
    for p in parts:
        args += ["-i", p]; n += 1
        if a.pause > 0: args += ["-f", "lavfi", "-t", str(a.pause), "-i", "anullsrc=r=24000:cl=mono"]; n += 1
    fc = "".join(f"[{i}:a]" for i in range(n)) + f"concat=n={n}:v=0:a=1[a]"
    subprocess.run(args + ["-filter_complex", fc, "-map", "[a]", "-ar", "24000", "-ac", "1", a.out], check=True)
    if a.manifest: json.dump({"voice": a.voice, "speed": a.speed, "pause": a.pause, "total": round(dur(a.out), 3), "segments": man}, open(a.manifest, "w"), indent=1)
    print(f"wrote {a.out} ({dur(a.out):.1f}s, {len(segs)} segments)")

if __name__ == "__main__":
    main()
