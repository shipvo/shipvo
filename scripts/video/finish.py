#!/usr/bin/env python3
"""finish.py: one-command post-production for a film whose picture is already rendered.

The picture (characters, sets, shots) is always made fresh for each film. This only does the
shared finishing work, the same way every time:

  1. sound effects: a whoosh on every cut it detects in the picture, plus hits you choose
     (--hits "6:boom,55:chime,68.5:boom"), synthesised, nothing to credit
  2. music: your track from --music-offset, faded in and out, ducked hard under the voices
  3. voices: vo.wav from dialogue.py, cleaned and placed above the music
  4. loudness: -14 LUFS for social (--lufs to change)
  5. subtitles: <out>.vtt from lines.json, and burned into the picture with --burn-subs
  6. checks: voice clarity over the music on every line, pacing (pacing.py, if it sits next to
     this file), a 10-frame contact sheet, and <out>.report.md with every result

  python3 finish.py --video silent.mp4 --vo vo.wav --lines lines.json \
      --music track.mp3 --music-offset 59 --credit "Music: ..." --hits "6:boom,55:chime" --out final.mp4

Needs ffmpeg and numpy. Exits 1 if a check fails.
"""
import argparse, json, os, re, subprocess, sys
import numpy as np

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))


def run(args, **kw):
    return subprocess.run(args, capture_output=True, text=True, **kw)


def duration(path):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).stdout.strip())


def cut_times(video, threshold=0.3):
    r = run(["ffmpeg", "-hide_banner", "-i", video, "-an", "-vf", f"select='gt(scene,{threshold})',showinfo", "-f", "null", "-"])
    return [float(t) for t in re.findall(r"pts_time:([0-9.]+)", r.stderr)]


# ---- sound effects, synthesised ----
rng = np.random.default_rng(7)


def lowpass(x, k):
    y = np.empty_like(x); acc = 0.0
    for i, v in enumerate(x):
        acc += k * (v - acc); y[i] = acc
    return y


def whoosh(d=0.42):
    n = rng.standard_normal(int(d * SR)); t = np.linspace(0, 1, len(n))
    env = np.sin(np.pi * t) ** 2
    return (lowpass(n, .08) * 1.6 + lowpass(n, .3) * t * .6) * env / 2


def ping(f=1320, d=.6):
    t = np.arange(int(d * SR)) / SR
    return (np.sin(2 * np.pi * f * t) + .5 * np.sin(2 * np.pi * f * 1.5 * t)) * np.exp(-t * 9) * .35


def chime():
    return sum(ping(f, 1.2) * g for f, g in [(1568, .6), (2093, .45), (2637, .35)])


def boom():
    t = np.arange(int(1.4 * SR)) / SR
    return (np.sin(2 * np.pi * (55 - 20 * t) * t) * np.exp(-t * 3) + lowpass(rng.standard_normal(len(t)), .05) * np.exp(-t * 6) * 1.5) * .7


def pop():
    t = np.arange(int(.08 * SR)) / SR
    return np.sin(2 * np.pi * (900 - 5000 * t) * t) * np.exp(-t * 50) * .4


def riser(d=1.2):
    t = np.arange(int(d * SR)) / SR
    return np.sin(2 * np.pi * (200 + 900 * (t / d) ** 2) * t) * (t / d) ** 2 * .18 + lowpass(rng.standard_normal(len(t)), .2) * (t / d) ** 3 * .25


SFX = {"whoosh": whoosh, "chime": chime, "boom": boom, "pop": pop, "ping": ping, "riser": riser}


def build_sfx(total, cuts, hits, path):
    out = np.zeros((int(total * SR), 2))

    def add(sig, t, gain=1.0, pan=0.0):
        i = int(max(0, t) * SR); s = sig[: max(0, min(len(sig), len(out) - i))] * gain
        out[i: i + len(s), 0] += s * (1 - max(0, pan)); out[i: i + len(s), 1] += s * (1 + min(0, pan))

    for k, c in enumerate(cuts):
        add(whoosh(), c - .22, .55, pan=(rng.random() - .5) * .5)
    for t, name in hits:
        if name == "riser":
            add(riser(), t - 1.2, 1.0)
        else:
            add(SFX[name](), t, .9)
    out /= max(1.0, np.abs(out).max() / .9)
    pcm = (out * 32767).astype("<i2").tobytes()
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "2", "-i", "-", path], input=pcm, check=True)
    return len(cuts), len(hits)


def write_vtt(lines, path, names):
    def ts(s):
        h, m = int(s // 3600), int(s % 3600 // 60)
        return f"{h:02d}:{m:02d}:{s % 60:06.3f}"
    with open(path, "w") as f:
        f.write("WEBVTT\n\n")
        for i, l in enumerate(lines, 1):
            who = f"<v {l['who'].title()}>" if names else ""
            f.write(f"{i}\n{ts(l['start'])} --> {ts(l['end'] + .25)}\n{who}{l['text']}\n\n")


def rms_db(path, start, dur):
    r = run(["ffmpeg", "-hide_banner", "-ss", str(start), "-t", str(dur), "-i", path, "-af", "volumedetect", "-f", "null", "-"])
    m = re.search(r"mean_volume: (-?[0-9.]+) dB", r.stderr)
    return float(m.group(1)) if m else -99.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, help="silent picture from the renderer")
    ap.add_argument("--vo", help="vo.wav from dialogue.py")
    ap.add_argument("--lines", help="lines.json from dialogue.py (subtitles and the clarity check)")
    ap.add_argument("--music"); ap.add_argument("--music-offset", type=float, default=0.0)
    ap.add_argument("--music-gain", type=float, default=0.5)
    ap.add_argument("--credit", default="", help="credit line for the music, saved next to the film")
    ap.add_argument("--hits", default="", help="comma list of time:sound, sounds: " + ", ".join(SFX))
    ap.add_argument("--shots", help="shots.json written by the renderer: exact cut times for effects and pacing")
    ap.add_argument("--no-cut-whoosh", action="store_true")
    ap.add_argument("--lufs", type=float, default=-14.0)
    ap.add_argument("--burn-subs", action="store_true", help="also burn the subtitles into the picture")
    ap.add_argument("--speaker-names", action="store_true", help="put speaker names in the subtitles")
    ap.add_argument("--out", default="final.mp4")
    a = ap.parse_args()

    base = os.path.splitext(a.out)[0]
    work = base + "_work"; os.makedirs(work, exist_ok=True)
    total = duration(a.video)
    report, fails = [f"# Finish report: {os.path.basename(a.out)}", "", f"- Length: {total:.1f} s"], []

    # 1. effects
    known = [float(x[0]) if isinstance(x, list) else float(x) for x in json.load(open(a.shots))][1:] if a.shots else []
    cuts = [] if a.no_cut_whoosh else sorted(set(round(c, 2) for c in known or [c for c in cut_times(a.video) if c > .3]))
    hits = []
    for h in filter(None, a.hits.split(",")):
        t, name = h.split(":"); name = name.strip()
        if name not in SFX: sys.exit(f"unknown sound {name!r}; use one of {', '.join(SFX)}")
        hits.append((float(t), name))
    sfx = os.path.join(work, "sfx.wav")
    nc, nh = build_sfx(total, cuts, hits, sfx)
    report.append(f"- Effects: {nc} cut whooshes, {nh} hits")

    # 2-4. mix
    inputs, chains, bed = ["-i", a.video, "-i", sfx], ["[1:a]aresample=48000,aformat=channel_layouts=stereo[fx]"], "[fx]"
    n = 2
    if a.music:
        inputs += ["-ss", str(a.music_offset), "-i", a.music]
        chains.append(f"[{n}:a]atrim=0:{total:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=1,afade=t=out:st={max(0, total - 2.5):.3f}:d=2.5,"
                      f"volume={a.music_gain},aresample=48000,aformat=channel_layouts=stereo[mu]")
        chains.append("[mu][fx]amix=inputs=2:normalize=0[bed]"); bed = "[bed]"; n += 1
    if a.vo:
        inputs += ["-i", a.vo]
        chains.append(f"[{n}:a]aresample=48000,aformat=channel_layouts=stereo,asplit=2[key][v]")
        chains.append(f"{bed}[key]sidechaincompress=threshold=0.008:ratio=20:attack=10:release=400[duck]")
        chains.append("[v]highpass=f=90,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,volume=3.5[vc]")
        # stems for the clarity check: the ducked music and effects, and the processed voice
        run(["ffmpeg", "-loglevel", "error", "-y", *inputs, "-filter_complex", ";".join(chains),
             "-map", "[duck]", os.path.join(work, "bed.wav"), "-map", "[vc]", os.path.join(work, "voice.wav")])
        chains.append("[duck][vc]amix=inputs=2:normalize=0[pre]"); n += 1
    else:
        chains.append(f"{bed}anull[pre]")
    chains.append(f"[pre]loudnorm=I={a.lufs}:TP=-1.5:LRA=11[a]")
    vf = []
    if a.lines:
        lines = json.load(open(a.lines))
        write_vtt(lines, base + ".vtt", a.speaker_names)
        report.append(f"- Subtitles: {base}.vtt ({len(lines)} lines)")
        if a.burn_subs:
            vf = ["-vf", f"subtitles={base}.vtt:force_style='FontName=Poppins,FontSize=20,Outline=2,MarginV=28'"]
    r = run(["ffmpeg", "-loglevel", "error", "-y", *inputs, "-filter_complex", ";".join(chains), "-map", "0:v", "-map", "[a]",
             *(vf or ["-c:v", "copy"]), "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", a.out])
    if r.returncode:
        sys.exit("mix failed: " + r.stderr[-800:])
    report.append(f"- Loudness target: {a.lufs} LUFS")
    if a.credit:
        open(base + ".credits.txt", "w").write(a.credit + "\n"); report.append(f"- Credit: {a.credit}")

    # 6. checks
    if a.vo and a.lines:
        worst = None
        for l in lines:
            d = max(.3, l["end"] - l["start"])
            margin = rms_db(os.path.join(work, "voice.wav"), l["start"], d) - rms_db(os.path.join(work, "bed.wav"), l["start"], d)
            if worst is None or margin < worst[0]: worst = (margin, l)
        ok = worst[0] >= 10
        report.append(f"- Voice clarity: weakest line {worst[0]:.1f} dB above the music (\"{worst[1]['text']}\" at {worst[1]['start']} s) "
                      f"{'PASS' if ok else 'FAIL: needs 10 dB; lower --music-gain'}")
        if not ok: fails.append("voice clarity")
    pacing = os.path.join(HERE, "pacing.py")
    if os.path.exists(pacing):
        r = run([sys.executable, pacing, a.out] + (["--shots", a.shots] if a.shots else []))
        lines_out = [x for x in r.stdout.strip().splitlines() if x]
        report.append(f"- Pacing: {lines_out[0] if lines_out else '?'} {'PASS' if r.returncode == 0 else 'FAIL'}")
        report += [f"  - {x}" for x in lines_out if x.startswith("FAIL")]
        if r.returncode: fails.append("pacing")
    sheet = base + ".sheet.jpg"
    step = max(1, int(total * 30 / 10))
    run(["ffmpeg", "-loglevel", "error", "-y", "-i", a.out, "-vf", f"select='not(mod(n\\,{step}))',scale=384:-1,tile=5x2", "-frames:v", "1", sheet])
    report.append(f"- Contact sheet: {sheet}")
    report.append("")
    report.append("Result: " + ("PASS" if not fails else "FAIL (" + ", ".join(fails) + ")"))
    open(base + ".report.md", "w").write("\n".join(report) + "\n")
    print("\n".join(report))
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
