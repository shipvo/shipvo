#!/usr/bin/env python3
"""Measure a rendered video's pacing so the retention gate is a check, not an opinion.

  python3 scripts/video/pacing.py video.mp4 [--max-static 2] [--max-gap 6] [--hook 3] [--json out.json]

Reports cuts (scene changes), static stretches (frozen picture), the longest gap
between visual changes, and whether something changes inside the hook window.
Exits 1 when a rule fails, so it can gate a render. Needs ffmpeg.
"""
import argparse, json, re, subprocess, sys


def probe_duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True).stdout.strip()
    return float(out)


def cuts(path, threshold):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-an", "-vf",
                        f"select='gt(scene,{threshold})',showinfo", "-f", "null", "-"],
                       capture_output=True, text=True)
    return [float(m) for m in re.findall(r"pts_time:([0-9.]+)", r.stderr)]


def freezes(path, seconds):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-an", "-vf",
                        f"freezedetect=n=0.002:d={seconds}", "-f", "null", "-"],
                       capture_output=True, text=True)
    starts = [float(x) for x in re.findall(r"freeze_start: ([0-9.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"freeze_end: ([0-9.]+)", r.stderr)]
    return starts, ends


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--max-static", type=float, default=2.0, help="longest allowed frozen picture, seconds")
    ap.add_argument("--max-gap", type=float, default=6.0, help="longest allowed time between cuts, seconds")
    ap.add_argument("--hook", type=float, default=3.0, help="something must change inside the first N seconds")
    ap.add_argument("--scene", type=float, default=0.3, help="scene-change threshold (0 to 1)")
    ap.add_argument("--json", default=None)
    a = ap.parse_args()

    dur = probe_duration(a.video)
    c = cuts(a.video, a.scene)
    fs, fe = freezes(a.video, a.max_static)
    if len(fe) < len(fs):
        fe.append(dur)
    static = [(round(s, 2), round(e - s, 2)) for s, e in zip(fs, fe)]
    # the end card may hold still; ignore a freeze that starts in the last 5 s
    static = [x for x in static if x[0] < dur - 5]

    marks = [0.0] + c + [dur]
    gaps = [(round(marks[i], 2), round(marks[i + 1] - marks[i], 2)) for i in range(len(marks) - 1)]
    longest = max(gaps, key=lambda g: g[1]) if gaps else (0, dur)
    hook_ok = any(t <= a.hook for t in c) or not any(s <= a.hook for s, _ in static)

    report = {
        "duration": round(dur, 2), "cuts": len(c), "cuts_per_min": round(len(c) / dur * 60, 1),
        "longest_gap": {"at": longest[0], "seconds": longest[1]}, "static": static,
        "hook_moves": hook_ok, "cut_times": [round(t, 2) for t in c],
    }
    fails = []
    if static:
        fails.append(f"frozen picture over {a.max_static}s at " + ", ".join(f"{s}s ({d}s)" for s, d in static))
    if longest[1] > a.max_gap:
        fails.append(f"no cut for {longest[1]}s from {longest[0]}s (max {a.max_gap}s); move the camera or cut")
    if not hook_ok:
        fails.append(f"nothing moves in the first {a.hook}s")
    report["pass"] = not fails
    report["fails"] = fails

    print(f"{report['duration']}s, {report['cuts']} cuts ({report['cuts_per_min']}/min), "
          f"longest gap {longest[1]}s at {longest[0]}s, static stretches {len(static)}")
    for f in fails:
        print("FAIL:", f)
    print("PASS" if not fails else "pacing check failed")
    if a.json:
        json.dump(report, open(a.json, "w"), indent=2)
    sys.exit(0 if not fails else 1)


if __name__ == "__main__":
    main()
