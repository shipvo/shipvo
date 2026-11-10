#!/usr/bin/env python3
"""Cut the main film's voices (vo.wav, lines.json from dialogue.py) to the vertical segments in vertical.mjs.
  python3 vertical-audio.py <dialogue build dir> <out dir>
Writes vo.wav and lines.json on the vertical timeline. Needs ffmpeg."""
import json, os, re, subprocess, sys
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
text = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "vertical.mjs")).read()
segs = [(float(a), float(b)) for a, b in re.findall(r"from: ([\d.]+), to: ([\d.]+)", text)]
parts = "".join(f"[0:a]atrim={a}:{b},asetpts=PTS-STARTPTS[a{i}];" for i, (a, b) in enumerate(segs))
fc = parts + "".join(f"[a{i}]" for i in range(len(segs))) + f"concat=n={len(segs)}:v=0:a=1[o]"
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(src, "vo.wav"), "-filter_complex", fc, "-map", "[o]", os.path.join(out, "vo.wav")], check=True)
lines, acc = [], 0.0
for a, b in segs:
    for l in json.load(open(os.path.join(src, "lines.json"))):
        if l["start"] >= a - 0.05 and l["end"] <= b + 0.3:
            lines.append({**l, "start": round(l["start"] - a + acc, 3), "end": round(l["end"] - a + acc, 3)})
    acc += b - a
json.dump(lines, open(os.path.join(out, "lines.json"), "w"), indent=1)
print(f"{acc:.1f} s, {len(lines)} lines")
