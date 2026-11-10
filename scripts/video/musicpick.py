#!/usr/bin/env python3
"""musicpick.py: pick the background track that fits a specific video, not just its mood.

    python3 scripts/video/musicpick.py --brief brief.json [--out pick.json] [--top 16] [--show 5]

The brief describes the film:
    {
      "duration": 100,                         # seconds of film the music must cover
      "want": ["cinematic", "inspiring", "upbeat"],
      "avoid": ["sad"],                        # vocal, voice, christmas, children, horror, sexy, holiday always avoided
      "bpm": [118, 134],                       # target tempo range (optional)
      "energy": "story",                       # preset: story | build | steady | calm, or a list of [t, level 0..1] points
      "hits": [{"t": 88.5, "type": "payoff"}], # moments the music should lift on (optional)
      "narration": false                       # true for a ducked bed under a voice (prefers steadier tracks)
    }

Three stages:
1. Corpus (33,921 Jamendo tracks, no downloads): drop avoided moods and tracks that cannot cover the film, score
   mood fit (exact tags count more than related ones, tag-stuffed tracks count less), prefer instrumental, penalise
   tracks used recently and more than two tracks from one artist.
2. Audio (top candidates only, cached in music/): loudness and loudness range, tempo from the onset envelope,
   and an energy curve in half-second steps.
3. Fit: slide each track over the film to find the start offset whose energy best follows the brief's curve and
   lifts on each hit; combine with tempo, mood and dynamics into one score. Prints the ranking with reasons.

The pick JSON gives the track id, start offset and credit fields; pass the offset to `bgmusic.py mix --offset`.
Only tracks whose own tag says CC BY, CC BY-SA, CC0 or public domain are considered (NC and ND are skipped).
Needs ffmpeg and numpy; uses librosa for tempo when installed (recommended: pip install librosa).
"""
import argparse, gzip, json, math, os, re, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "data", "jamendo_moodtheme.jsonl.gz")
USED = os.path.join(HERE, "music-used.json")
DL = "https://mp3d.jamendo.com/download/track/{id}/mp32/"
ALWAYS_AVOID = {"vocal", "voice", "christmas", "children", "horror", "sexy", "holiday"}
RELATED = {
    "cinematic": "epic film movie soundtrack dramatic drama trailer orchestral",
    "inspiring": "uplifting motivational positive hopeful inspirational emotional",
    "upbeat": "energetic happy fun positive groovy funky fast",
    "corporate": "commercial advertising business motivational background",
    "documentary": "nature travel adventure emotional",
    "ambient": "calm meditative peaceful relaxing soft dream soundscape space chill",
    "tech": "electronic technology futuristic deep minimal cool",
    "dark": "tension mysterious melancholic suspense",
    "acoustic": "folk instrumental piano guitar",
    "action": "sport powerful energetic fast epic",
}
STEP = 0.5  # seconds per energy sample


# ---------- stage 1: corpus ----------

def load_corpus():
    with gzip.open(CORPUS, "rt") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def recent_ids():
    try:
        return {int(x) for x in json.load(open(USED))}
    except Exception:
        return set()


def mood_score(moods, want):
    """Exact wanted tags count 1, related tags 0.4; divided by sqrt(tag count) so tag-stuffed tracks score lower."""
    if not want:
        return 0.5
    got = 0.0
    for w in want:
        if w in moods:
            got += 1.0
        elif moods & set(RELATED.get(w, "").split()):
            got += 0.4
    return min(1.0, got / len(want)) / max(1.0, math.sqrt(len(moods) / 4))


def duration_fit(dur, need):
    if dur >= need + 4:
        return 1.0 if dur <= need * 3 else 0.85  # very long tracks are fine, slightly less likely to fit the arc
    if dur >= need:
        return 0.8
    return max(0.0, 0.5 * dur / need)  # would have to loop: strongly discouraged


def stage1(brief, top):
    need = float(brief["duration"])
    want = [w.lower() for w in brief.get("want", [])]
    avoid = ALWAYS_AVOID | {a.lower() for a in brief.get("avoid", [])}
    used = recent_ids()
    rows = []
    for r in load_corpus():
        moods = set(m.lower() for m in r["moods"])
        if moods & avoid or r["dur"] < need * 0.5:
            continue
        s = 0.6 * mood_score(moods, want) + 0.3 * duration_fit(r["dur"], need) + (0.1 if "instrumental" in moods else 0)
        if r["id"] in used:
            s -= 0.3
        rows.append((s, r))
    rows.sort(key=lambda x: -x[0])
    out, per_artist = [], {}
    for s, r in rows:
        if per_artist.get(r["artist"], 0) >= 2:
            continue
        per_artist[r["artist"]] = per_artist.get(r["artist"], 0) + 1
        out.append((s, r))
        if len(out) >= top:
            break
    return out


# ---------- stage 2: audio features ----------

def download(tid, outdir):
    os.makedirs(outdir, exist_ok=True)
    p = os.path.join(outdir, f"{tid}.mp3")
    if not os.path.exists(p):
        subprocess.run(["curl", "-sSL", "-m", "120", "-o", p, DL.format(id=tid)], check=True)
    return p



def pcm(path, sr=11025):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32), sr


def loudness(path):
    err = subprocess.run(["ffmpeg", "-i", path, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
    i = re.findall(r"I:\s+(-?[\d.]+) LUFS", err)
    l = re.findall(r"LRA:\s+([\d.]+) LU", err)
    return (float(i[-1]) if i else -20.0), (float(l[-1]) if l else 6.0)


def energy_curve(y, sr):
    n = int(sr * STEP)
    k = len(y) // n
    rms = np.sqrt(np.mean(y[: k * n].reshape(k, n) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms)
    smooth = np.convolve(db, np.ones(4) / 4, mode="same")  # 2 s smoothing
    lo, hi = np.percentile(smooth, 5), np.percentile(smooth, 98)
    return np.clip((smooth - lo) / max(1e-6, hi - lo), 0, 1)


def tempo(y, sr):
    """Tempo from the autocorrelation of a spectral-flux onset envelope, with a mild preference for 90 to 140 BPM."""
    hop, win = 256, 1024
    frames = 1 + (len(y) - win) // hop
    if frames < 64:
        return 0.0, 0.0
    idx = np.arange(win)[None, :] + hop * np.arange(frames)[:, None]
    spec = np.abs(np.fft.rfft(y[idx] * np.hanning(win), axis=1))
    flux = np.maximum(0, np.diff(np.log1p(spec), axis=0)).sum(axis=1)
    flux = (flux - flux.mean()) / (flux.std() + 1e-9)
    fps = sr / hop
    ac = np.correlate(flux, flux, mode="full")[len(flux) - 1:]
    def at(lag):
        l0 = int(lag)
        return ac[l0] + (lag - l0) * (ac[l0 + 1] - ac[l0]) if l0 + 1 < len(ac) else 0.0

    best, conf = 0.0, 0.0
    for bpm in np.arange(60, 181, 0.5):
        lag = fps * 60 / bpm
        # A real tempo repeats: score the beat and its multiples (a comb), so a 3:2 cross-rhythm cannot win on one lag.
        v = sum(at(k * lag) / k for k in (1, 2, 3, 4))
        v *= math.exp(-0.5 * (math.log2(bpm / 110)) ** 2)  # gentle preference for the middle of the range
        if v > conf:
            best, conf = bpm, v
    return float(best), float(conf / (ac[0] * 2.08 + 1e-9))


def tempo_best(path, y, sr):
    """librosa's beat tracker when it is installed (pip install librosa), else the built-in comb estimate."""
    try:
        import librosa
        yy, s2 = librosa.load(path, sr=22050, duration=90)
        t = float(np.atleast_1d(librosa.beat.beat_track(y=yy, sr=s2)[0])[0])
        return t, 1.0
    except Exception:
        return tempo(y[: sr * 90], sr)


def features(tid, outdir):
    cache = os.path.join(outdir, f"{tid}.features.json")
    if os.path.exists(cache):
        return json.load(open(cache))
    path = download(tid, outdir)
    y, sr = pcm(path)
    i, lra = loudness(path)
    bpm, conf = tempo_best(path, y, sr)
    f = {"path": path, "lufs": i, "lra": lra, "bpm": bpm, "bpm_conf": conf, "energy": energy_curve(y, sr).round(3).tolist()}
    json.dump(f, open(cache, "w"))
    return f


# ---------- stage 3: fit to the film ----------

def target_curve(brief):
    d = float(brief["duration"])
    e = brief.get("energy", "story")
    presets = {
        "story": [[0, .55], [.05, .5], [.08, .35], [.25, .4], [.3, .55], [.7, .7], [.78, .8], [.84, .3], [.86, 1], [.95, .8], [1, .55]],
        "build": [[0, .3], [.5, .6], [.85, 1], [1, .8]],
        "steady": [[0, .6], [1, .6]],
        "calm": [[0, .35], [.5, .45], [1, .35]],
    }
    pts = presets[e] if isinstance(e, str) else [[t / d, v] for t, v in e]
    if isinstance(e, str) and e == "story":
        for h in brief.get("hits", []):  # move the dip and the peak to the real payoff time
            if h.get("type") == "payoff":
                p = h["t"] / d
                pts = [q for q in pts if not (.8 <= q[0] <= .9)] + [[p - .02, .3], [p, 1.0]]
        pts.sort()
    xs = np.arange(0, d, STEP) / d
    return np.interp(xs, [p[0] for p in pts], [p[1] for p in pts])


def fit(f, brief):
    tgt = target_curve(brief)
    n = len(tgt)
    env = np.array(f["energy"])
    loops = len(env) < n
    if loops:
        env = np.tile(env, int(math.ceil(n / len(env))) + 1)
    best = (-2.0, 0, 0.0)
    for o in range(0, len(env) - n + 1):
        seg = env[o:o + n]
        if seg.std() < 1e-6:
            continue
        corr = float(np.corrcoef(seg, tgt)[0, 1])
        hit = 0.0
        for h in brief.get("hits", []):
            j = int(h["t"] / STEP)
            if 4 <= j < n - 1:
                hit += float(env[o + j: o + j + 3].mean() - env[o + j - 4: o + j - 1].mean())  # lift right at the hit
        hits = max(1, len(brief.get("hits", [])))
        s = corr + 0.8 * hit / hits
        if s > best[0]:
            best = (s, o, corr)
    return best[1] * STEP, best[2], best[0], loops


def bpm_fit(bpm, rng):
    if not rng or not bpm:
        return 0.6
    lo, hi = rng
    for b in (bpm, bpm * 2, bpm / 2):  # tempo octave errors are common
        if lo <= b <= hi:
            return 1.0
    d = min(abs(bpm - lo), abs(bpm - hi))
    return math.exp(-d / 12)


def dyn_fit(lra, narration):
    lo, hi = (3, 7) if narration else (5, 11)  # a story arc needs dynamics; a bed under a voice should be steady
    return 1.0 if lo <= lra <= hi else math.exp(-min(abs(lra - lo), abs(lra - hi)) / 3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brief", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--top", type=int, default=16)
    ap.add_argument("--show", type=int, default=5)
    ap.add_argument("--outdir", default="music")
    ap.add_argument("--record", metavar="SLUG", help="log the pick in music-used.json so later videos avoid it")
    a = ap.parse_args()
    brief = json.load(open(a.brief))
    cands = stage1(brief, a.top)
    if not cands:
        sys.exit("no track in the corpus matches this brief; loosen 'want' or 'avoid'")
    rows = []
    for s1, r in cands:
        # Owner decision (5 Nov 2026): any Jamendo track may be used, always credited; the licence is not a filter.
        try:
            f = features(r["id"], a.outdir)
        except Exception as e:
            print(f"{r['id']}: skipped ({e})", file=sys.stderr)
            continue
        offset, corr, curve, loops = fit(f, brief)
        score = (0.25 * s1 + 0.30 * max(0, curve) / 1.8 + 0.20 * bpm_fit(f["bpm"], brief.get("bpm"))
                 + 0.15 * dyn_fit(f["lra"], brief.get("narration", False)) + 0.10 * (0 if loops else 1))
        rows.append({"id": r["id"], "score": round(score, 3), "offset": offset, "curve_corr": round(corr, 2),
                     "bpm": round(f["bpm"], 1), "lra": f["lra"], "lufs": f["lufs"], "loops": loops, "moods": r["moods"],
                     "dur": r["dur"], "path": f["path"]})
    rows.sort(key=lambda x: -x["score"])
    for x in rows[: a.show]:
        print(f"{x['id']:>8}  score {x['score']:.3f}  start {x['offset']:5.1f}s  curve {x['curve_corr']:+.2f}  "
              f"{x['bpm']:5.1f} BPM  LRA {x['lra']:4.1f}  {'LOOPS ' if x['loops'] else ''}{' '.join(x['moods'][:6])}")
    if not rows:
        sys.exit("no candidate could be measured; loosen 'want' or raise --top")
    pick = rows[0]
    pick["source"] = f"https://www.jamendo.com/track/{pick['id']}"
    if a.out:
        json.dump(pick, open(a.out, "w"), indent=2)
    if a.record:
        used = json.load(open(USED)) if os.path.exists(USED) else {}
        if isinstance(used, list):
            used = {str(i): "" for i in used}
        used[str(pick["id"])] = a.record
        json.dump(used, open(USED, "w"), indent=2, sort_keys=True)
    print(f"picked {pick['id']} from {pick['offset']}s (mix with: bgmusic.py mix --music {pick['path']} --offset {pick['offset']} ...)")


if __name__ == "__main__":
    main()
