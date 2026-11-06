#!/usr/bin/env python3
"""bgmusic.py — pick and mix a background music bed from the Jamendo mood corpus.

  python3 bgmusic.py search  --want cinematic,documentary,corporate --avoid vocal,happy --min 120 --max 420 --n 6
  python3 bgmusic.py analyze --ids 1419110,1342581            # download + loudness/energy profile, ranks by steadiness
  python3 bgmusic.py mix --video in.mp4 --narration vo.wav --music music/1419110.mp3 --out out.mp4 [--bed 0.5] [--duck 0.015]
  python3 bgmusic.py auto --video in.mp4 --narration vo.wav --want cinematic,documentary --out out.mp4   # search+analyze+mix

Corpus: the full Jamendo mood/theme JSONL (33,921 tracks) if given with --corpus or found as
jamendo_moodtheme.jsonl next to this script; otherwise the built-in 155-track curated subset (8 clusters). For a pick that fits a specific film (tempo, energy curve, hit points, start offset) use musicpick.py, which searches all 33,921 tracks in data/jamendo_moodtheme.jsonl.gz.
Downloads come from https://mp3d.jamendo.com/download/track/<id>/mp32/ . Needs ffmpeg/ffprobe.
Credit the Jamendo track wherever the video is published.
Owner decision (5 Nov 2026): any Jamendo track may be used, always credited. `mix --credits PATH` writes the credit
(title, artist, licence, links) read from the track's own tags; `license` reports a track's licence.
"""
import argparse, json, os, re, subprocess, sys, random, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
DL = "https://mp3d.jamendo.com/download/track/{id}/mp32/"
CLUSTERS = {
 "cinematic": "cinematic epic film movie soundtrack dramatic drama trailer hero",
 "corporate": "corporate commercial advertising business motivational inspiring uplifting positive hopeful",
 "documentary": "documentary nature travel adventure emotional",
 "ambient": "ambient calm meditative peaceful relaxing soft dream spa soundscape space chill slow",
 "tech": "electronic technology futuristic deep minimal minimalist cool",
 "upbeat": "upbeat energetic happy fun summer party funky groovy fast sport action",
 "dark": "dark tension mysterious melancholic sad suspense",
 "acoustic": "acoustic folk instrumental piano guitar lounge romantic ballad love",
}
DEFAULT_AVOID = "vocal voice christmas children horror sexy holiday"

SUBSET = """989073|213|cinematic|drama,dramatic,emotional,epic,film,movie,peaceful,soundtrack,tragic
585837|92|cinematic|adventure,drama,epic,film,movie,soundtrack,trailer
1329955|67|cinematic|cinematic,epic,film,inspire,movie,soundtrack
1318712|164|cinematic|blockbuster,cinematic,epic,film,movie,soundtrack
1358791|151|cinematic|cinematic,epic,film,movie,neutral,soundtrack
1000085|176|cinematic|acoustic,action,adventure,dramatic,energetic,epic,film,movie,neutral,trailer
1395649|192|cinematic|cinematic,epic,film,motivacional,movie,soundtrack
1191327|95|cinematic|action,cinematic,corporate,epic,film,movie,neutral,trailer
1313858|156|cinematic|cinematic,epic,film,movie,neutral,soundtrack
1483765|158|cinematic|cinematic,epic,film,movie,neutral,soundtrack
1220661|262|cinematic|cinematic,epic,film,movie,soundtrack
1738418|141|cinematic|cinematic,epic,film,movie,soundtrack
1150771|150|cinematic|adventure,cinematic,corporate,epic,film,movie,trailer
1156041|121|cinematic|acoustic,cinematic,epic,film,movie,neutral,trailer
1158368|125|cinematic|acoustic,cinematic,dragon,dramatic,epic,soundtrack,trailer
1151403|140|cinematic|cinematic,documentary,drama,emotive,film,movie,soft,soundtrack
1382219|144|cinematic|cinematic,epic,film,hollywood,movie,neutral,soundtrack
1082095|144|cinematic|actionmusic,cinematic,epic,film,movie,trailer
1150778|62|cinematic|advertising,cinematic,epic,film,movie,trailer,uplifting
1436558|115|cinematic|cinematic,epic,film,movie,neutral,soundtrack,teaser
1352965|116|corporate|advertising,commercial,corporate,inspiring,motivational,neutral,popular,uplifting
1382980|180|corporate|commercial,corporate,hopeful,inspiring,motivational,positive,upbeat
1352945|88|corporate|advertising,commercial,corporate,inspiring,motivational,uplifting
1292687|144|corporate|advertising,background,commercial,corporate,motivational,uplifting
1284460|158|corporate|background,corporate,happy,inspiring,motivational,positive,soft,uplifting
1382940|98|corporate|commercial,corporate,hopeful,inspiring,motivational,upbeat
1314540|70|corporate|advertising,inspiring,motivational,positive,uplifting
1376262|160|corporate|advertising,corporate,inspiring,motivational,uplifting
1284457|181|corporate|corporate,inspiring,motivational,positive,upbeat,uplifiting,uplifting
1284456|130|corporate|corporate,electronic,inspiring,motivational,positive,uplifting
1185797|90|corporate|commercial,corporate,emotional,inspiring,motivational,uplifting
1326219|254|corporate|acoustic,advertising,commercial,corporate,inspiring,instrumental,positive,uprightbass
1284462|166|corporate|corporate,inspirational,inspiring,motivational,positive,presentations,upbeat,uplifting
1274264|137|corporate|corporate,inspiring,motivational,positive,uplifting
1189955|186|corporate|cool,corporate,hopeful,inspiring,motivational,uplifting
1405339|92|corporate|background,corporate,hopeful,inspiring,motivational,positive
1341606|60|corporate|corporate,inspiring,motivational,positive,uplifting
1405356|72|corporate|commercial,corporate,hopeful,inspiring,positive
1354704|138|corporate|advertising,corporate,inspiring,motivational,peaceful,upbeat,uplifting
1198666|147|corporate|corporate,happy,inspiring,motivational,positive,uplifting
949222|184|documentary|acoustic,adventure,corporate,documentary,drama,emotional,instrumental,nature,soft,travel
1216289|153|documentary|documentary,emotional,nature,romantic,soft,travel
1269563|170|documentary|acoustic,adventure,documentary,dream,emotional,energetic,instrumental,neutral,travel
417223|126|documentary|adventure,documentary,travel
900242|118|documentary|adventure,corporate,documentary,drama,nature
765496|266|documentary|documentary,drama,emotional,epic,nature
900243|110|documentary|adventure,corporate,documentary,drama,emotional,love,romantic
1185652|132|documentary|documentary,energetic,happy,nature,travel
81018|239|documentary|documentary,dream,emotional,meditative,nature,relaxing
1217927|170|documentary|commercial,documentary,history,nature,neutral,peaceful,travel
977262|227|documentary|adventure,emotional,nature,neutral
949232|151|documentary|ballad,corporate,documentary,drama,emotional,nature,soft
600112|128|documentary|adventure,documentary,drama,edgy,film,funky,groovy,neutral,sport,travel
1079389|142|documentary|adventure,documentary,drama,film,nature
977261|227|documentary|documentary,emotional,travel
900241|138|documentary|adventure,ambiental,corporate,documentary,emotional
908093|292|documentary|emotional,nature,sad,soft,travel
1077954|163|documentary|adventure,advertising,documentary,drama,film,nature
1027925|169|documentary|adventure,advertising,documentary,drama,nature
1027915|219|documentary|corporate,documentary,drama,emotional,lounge,nature,sad
979848|304|ambient|ambient,calm,meditative,peaceful,relaxing,spa
979838|283|ambient|ambient,calm,meditative,peaceful,relaxing,spa
979859|319|ambient|acoustic,ambient,calm,instrumental,meditative,relaxing,slow,spa
979867|320|ambient|ambient,calm,meditative,peaceful,relaxing,spa
979868|315|ambient|ambient,background,calm,meditative,peaceful,relaxing,soft
979835|302|ambient|ambient,background,calm,meditative,peaceful,relaxing,soft
979870|340|ambient|ambient,calm,meditative,peaceful,relaxing,spa
979858|312|ambient|ambient,calm,meditative,peaceful,relaxing,spa
979839|331|ambient|ambient,background,calm,meditative,peaceful,relaxing,soft
979866|310|ambient|ambient,calm,meditative,peaceful,relaxing,spa
1149313|417|ambient|chill,dream,emotional,peaceful,relaxing,sad,slow,soft
979849|320|ambient|ambient,background,calm,meditative,peaceful,relaxing,soft
979863|299|ambient|ambient,background,calm,meditative,peaceful,relaxing,soft
979842|299|ambient|ambient,calm,peaceful,relaxing,spa
173753|186|ambient|dream,meditative,peaceful,relaxing,soundscape
173759|212|ambient|dream,meditative,peaceful,relaxing,soundscape
341563|116|ambient|calm,chill,electronic,happy,hopeful,lounge,mellow,peaceful,relaxing,soft
979857|305|ambient|background,calm,meditative,peaceful,relaxing,soft
979845|327|ambient|calm,meditative,peaceful,relaxing,spa
708472|209|ambient|ambient,chill,documentary,lounge,meditative,neutral,peaceful,relaxing
29871|162|tech|atmospheric,deep,electronic,mellow,original,soft
29866|257|tech|atmospheric,deep,electronic,mellow,soft
29870|303|tech|atmospheric,chill,deep,electronic,mellow,soft
29863|167|tech|atmospheric,chill,deep,electronic,mellow,original,soft
290863|137|tech|cool,improvisation,minimal,sad
1553343|120|tech|advertising,cool,inspirational,neutral,technology
1384689|276|tech|cool,deep
29873|184|tech|atmospheric,deep,electronic,mellow,original,soft
1314132|326|tech|deep,happy,lounges,minimal,neutral,soft
1380979|252|tech|cool,deep
29868|328|tech|ambient,atmospheric,deep,electronic,mellow,soft,trippy
29869|227|tech|atmospheric,chill,deep,electronic,mellow,soft
1278619|120|tech|battery,electronic,melancholic,minimal,neutral
1519011|72|tech|background,minimal,sad,technology
29864|170|tech|ambient,atmospheric,deep,electronic,mellow,original,soft,trippy
1277569|245|upbeat|acoustic,energetic,funky,happy,summer,upbeat
1294779|106|upbeat|energetic,fun,groovy,happy,positive,upbeat
1294747|157|upbeat|energetic,fun,happy,motivational,party,positive,upbeat
1210716|151|upbeat|energetic,fun,happy,motivational,party
1366863|110|upbeat|action,energetic,happy,positive,powerful,upbeat,uplifting
1294767|151|upbeat|energetic,fun,happy,motivational,positive,upbeat
945192|225|upbeat|energetic,groovy,happy,summer,uplift
1250049|192|upbeat|energetic,fun,happy,party
1951624|129|upbeat|funky,groovy,happy,sport
1637616|176|upbeat|funky,happy,party,positive,upbeat
1822771|205|upbeat|funky,groovy,happy,summer
1250057|157|upbeat|energetic,fun,happy,party
1366862|80|upbeat|action,corporate,energetic,happy,powerfu,upbeat
1210720|182|upbeat|cool,fun,groovy,happy,upbeat
1235365|164|upbeat|energetic,happy,party,upbeat,uplifting
1250052|126|upbeat|energetic,fun,happy,party
1210691|147|upbeat|energetic,fun,happy,motivational,party
1210715|130|upbeat|acoustic,cool,fun,groovy,happy,party
1216210|182|upbeat|action,adventure,energetic,happy,nature,sport
1250055|173|upbeat|energetic,fun,happy,party
1199052|131|dark|dark,melancholic,sad
1267752|145|dark|dark,melancholic,sad
1178100|195|dark|dark,ethnic,melancholic,melodic,peaceful,sad
1203202|280|dark|dark,drama,emotional,melancholic,sad
1203201|197|dark|calm,dark,drama,dramatic,emotional,melancholic,sad
1199051|134|dark|dark,dramatic,melancholic,sad
366014|205|dark|dark,melancholic,sad
1228625|131|dark|dark,sad
1273974|185|dark|dark,lowfi,sad
26433|121|dark|acoustic,melancholic,peaceful,sad,soundtrack
1375974|122|dark|dark,sad
477307|333|dark|acoustic,drama,dramatic,dreamy,emotional,energetic,melancholic,sad
871995|378|dark|dark,melancholic
1228627|216|dark|dark,sad
1214930|319|dark|melancholic,sad
1367187|271|dark|dark,film,movie,rock80,sad
1084375|129|dark|melancholic,sad
1228759|271|dark|dark,sad
1219702|208|dark|dark,melancholic
1885164|139|dark|drama,melancholic,sad
1269564|163|acoustic|acoustic,documentary,emotional,film,happy,instrumental,love,movie,relaxing,romantic
1214580|146|acoustic|acoustic,dream,happy,instrumental,love,romantic
477393|131|acoustic|acoustic,adventure,adventurous,epic,instrumental,love,romantic
1527213|262|acoustic|ballad,ballade,happy,love,romantic
816195|230|acoustic|acoustic,drama,dream,emotional,instrumental,love,neutral,soft,soundtrack
1219600|333|acoustic|acoustic,ballad,ballade,energetic,instrumental
15160|267|acoustic|acoustic,advertising,ballad,instrumental,journey,neutral
1195873|111|acoustic|acoustic,emotional,instrumental,romantic,sentimental
816196|171|acoustic|acoustic,drama,dream,emotional,instrumental,love,soft
1515343|90|acoustic|acoustic,instrumental,melodic,neutral,romantic
1148183|220|acoustic|acoustic,ballad,instrumental,melodic,motivational,neutral
1208039|265|acoustic|ballad,love,romantic,slow
1313076|175|acoustic|acoustic,drama,instrumental,modern,romantic,sad
1891854|152|acoustic|acoustic,ballad,romantic
1245136|125|acoustic|acoustic,ballad,honkytonk,inspiring,instrumental
35174|247|acoustic|acoustic,ballad,instrumental,nostalgie
633200|356|acoustic|acoustic,dream,instrumental,love,sad
189625|278|acoustic|acoustic,chill,instrumental,lounge,middle
1413279|251|acoustic|acoustic,balada,ballad,instrumental,neutral
589414|66|acoustic|acoustic,energetic,film,love,melancholic,movie,neutral,romantic,sad"""

def load_corpus(path):
    if path and os.path.exists(path):
        for line in open(path):
            if line.strip():
                r = json.loads(line); yield {"id": r["numeric_id"], "dur": r["duration_sec"], "moods": set(r["moods"])}
        return
    for line in SUBSET.strip().splitlines():
        i, d, c, m = line.split("|"); yield {"id": int(i), "dur": float(d), "moods": set(m.split(",")) | {c}}

def expand(terms):
    out = set()
    for t in [x.strip() for x in terms.split(",") if x.strip()]:
        out |= set(CLUSTERS.get(t, t).split())
    return out

def search(a):
    want, avoid = expand(a.want), expand(a.avoid) | set(DEFAULT_AVOID.split())
    rows = []
    for r in load_corpus(a.corpus):
        if r["moods"] & avoid or not (a.min <= r["dur"] <= a.max):
            continue
        s = len(r["moods"] & want)
        if s >= a.min_score:
            rows.append((s, r))
    random.seed(a.seed); random.shuffle(rows); rows.sort(key=lambda x: -x[0])
    for s, r in rows[:a.n]:
        print(f"{r['id']:>8}  score {s}  {int(r['dur']):>3}s  {' '.join(sorted(r['moods']))}")
    return [r["id"] for s, r in rows[:a.n]]

def ffprobe_dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]))

def download(tid, outdir):
    os.makedirs(outdir, exist_ok=True); p = os.path.join(outdir, f"{tid}.mp3")
    if not os.path.exists(p):
        subprocess.run(["curl", "-sSL", "-m", "120", "-o", p, DL.format(id=tid)], check=True)
        out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", p], capture_output=True, text=True).stdout
        if "audio" not in out:
            os.remove(p); raise RuntimeError(f"{tid}: not audio (download failed?)")
    return p

def loudness(p):
    out = subprocess.run(["ffmpeg", "-i", p, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
    I = re.findall(r"I:\s+(-?[\d.]+) LUFS", out); L = re.findall(r"LRA:\s+([\d.]+) LU", out)
    return float(I[-1]), float(L[-1])

def analyze(a, ids=None):
    ids = ids or [int(x) for x in a.ids.split(",")]
    res = []
    for t in ids:
        try:
            p = download(t, a.outdir); I, L = loudness(p)
            res.append((L, t, p, I, ffprobe_dur(p)))
        except Exception as e:
            print(f"{t}: skipped ({e})", file=sys.stderr)
    res.sort()   # flattest energy profile first: a bed must not surge through the voice
    for L, t, p, I, d in res:
        print(f"{t:>8}  LRA {L:4.1f} LU  I {I:6.1f} LUFS  {int(d)}s  {p}")
    return res

def mix(a):
    work = a.work or os.path.dirname(os.path.abspath(a.out)) or "."
    os.makedirs(work, exist_ok=True)
    vlen = ffprobe_dur(a.video); alen = ffprobe_dur(a.narration) if a.narration else vlen
    D = max(vlen, alen) + 0.5
    vo = os.path.join(work, "_vo.wav"); mus = os.path.join(work, "_mus.wav"); mixw = os.path.join(work, "_mix.wav")
    # normalise in SEPARATE passes: loudnorm inside a filter graph shortens the output by its lookahead
    if a.narration:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", a.narration, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", vo], check=True)
    I, L = loudness(a.music); gain = a.music_lufs - I
    loops = int(D // max(1.0, ffprobe_dur(a.music))) + 1
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-stream_loop", str(loops), "-ss", f"{a.offset:.2f}", "-i", a.music, "-t", f"{D:.2f}",
                    "-af", f"volume={gain:.2f}dB", "-ar", "48000", mus], check=True)
    fo = max(0.0, min(vlen, alen) - a.fade_out)
    if a.narration:
        fc = (f"[0:a]asplit=2[vo][key];"
              f"[1:a]afade=t=in:st=0:d={a.fade_in},afade=t=out:st={fo:.2f}:d={a.fade_out},volume={a.bed}[m0];"
              f"[m0][key]sidechaincompress=threshold={a.duck}:ratio={a.ratio}:attack=40:release=700:makeup=1[md];"
              f"[vo][md]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", vo, "-i", mus, "-filter_complex", fc, "-map", "[a]", "-ar", "48000", "-ac", "2", mixw], check=True)
    else:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mus, "-af", f"afade=t=in:st=0:d={a.fade_in},afade=t=out:st={fo:.2f}:d={a.fade_out},volume={a.bed_solo}", "-ar", "48000", "-ac", "2", mixw], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", a.video, "-i", mixw, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
                    "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", a.out], check=True)
    if a.credits:
        tid = re.sub(r"\D", "", os.path.basename(a.music).split(".")[0]) or "0"
        cred = {"video": os.path.basename(a.out), "music": track_credit(tid, a.music),
                "credit_line": None}
        c = cred["music"]; cred["credit_line"] = f'Music: "{c["title"]}" by {c["artist"]} ({c["provider"]}, {c["license"]}) {c["source"]}'
        old = json.load(open(a.credits)) if os.path.exists(a.credits) else {}
        old.update(cred); json.dump(old, open(a.credits, "w"), indent=2); open(a.credits, "a").write("\n")
        print(f"credits: {a.credits}: {cred['credit_line']}")
    Im, Lm = loudness(mixw)
    print(f"wrote {a.out}  ({ffprobe_dur(a.out):.1f}s, mix {Im:.1f} LUFS, LRA {Lm:.1f} LU, music {os.path.basename(a.music)} at {a.music_lufs} LUFS x{a.bed}, ducked by narration)")

ALLOWED = ("by", "by-sa", "publicdomain", "zero")

def track_license(tid):
    """The licence each Jamendo MP3 states in its own ID3 copyright tag (first 64 KB of the file)."""
    data = subprocess.run(["curl", "-sSL", "-m", "30", "-r", "0-65535", DL.format(id=tid)], capture_output=True).stdout
    m = re.search(rb"creativecommons\.org/(?:licenses|publicdomain)/([a-z-]+)/", data)
    return m.group(1).decode() if m else "unknown"

def track_credit(tid, path):
    """Title, artist and licence from the MP3's own ID3 tags."""
    tags = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format_tags", "-of", "json", path],
                                     capture_output=True, text=True).stdout or "{}").get("format", {}).get("tags", {})
    tags = {k.lower(): v for k, v in tags.items()}
    lic_url = tags.get("copyright", "")
    m = re.search(r"creativecommons\.org/(?:licenses|publicdomain)/([a-z-]+)/([0-9.]+)", lic_url)
    return {"id": int(tid), "title": tags.get("title", ""), "artist": tags.get("artist", ""),
            "license": f"CC {m.group(1).upper()} {m.group(2)}" if m else "see source", "license_url": lic_url,
            "source": f"https://www.jamendo.com/track/{tid}", "provider": "Jamendo"}

def license(a):
    """Print each track's licence; exit 1 if any does not allow commercial use with changes (CC BY, CC BY-SA, CC0)."""
    bad = 0
    for t in [x.strip() for x in a.ids.split(",") if x.strip()]:
        lic = track_license(t); ok = lic in ALLOWED; bad += not ok
        print(f"{t:>8}  cc-{lic:<10} {'OK for Shipvo videos (credit the artist)' if ok else 'NOT allowed: non-commercial or no-derivatives'}")
    sys.exit(1 if bad else 0)

def main():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    def common(p):
        p.add_argument("--corpus", default=os.path.join(HERE, "jamendo_moodtheme.jsonl"))
        p.add_argument("--want", default="cinematic,documentary,corporate"); p.add_argument("--avoid", default="")
        p.add_argument("--min", type=float, default=120); p.add_argument("--max", type=float, default=420)
        p.add_argument("--min-score", dest="min_score", type=int, default=2); p.add_argument("--n", type=int, default=6)
        p.add_argument("--seed", type=int, default=1); p.add_argument("--outdir", default="music")
    s = sub.add_parser("search"); common(s)
    z = sub.add_parser("analyze"); common(z); z.add_argument("--ids", required=True)
    def mixargs(p):
        p.add_argument("--video", required=True); p.add_argument("--narration", default=None); p.add_argument("--out", required=True)
        p.add_argument("--bed", type=float, default=0.5, help="music volume under narration before ducking")
        p.add_argument("--bed-solo", dest="bed_solo", type=float, default=0.85, help="music volume when there is no narration")
        p.add_argument("--duck", type=float, default=0.015, help="sidechain threshold (lower = ducks on quieter speech)")
        p.add_argument("--ratio", type=float, default=10); p.add_argument("--music-lufs", dest="music_lufs", type=float, default=-20)
        p.add_argument("--fade-in", dest="fade_in", type=float, default=2.0); p.add_argument("--fade-out", dest="fade_out", type=float, default=3.5)
        p.add_argument("--work", default=None)
        p.add_argument("--offset", type=float, default=0.0, help="start the track this many seconds in (from musicpick.py)")
        p.add_argument("--credits", default=None, help="write the music credit JSON here (e.g. services/site/public/videos/<slug>.credits.json)")
    m = sub.add_parser("mix"); mixargs(m); m.add_argument("--music", required=True)
    li = sub.add_parser("license"); li.add_argument("--ids", required=True)
    au = sub.add_parser("auto"); common(au); mixargs(au)
    a = ap.parse_args()
    if a.cmd == "search": search(a)
    elif a.cmd == "analyze": analyze(a)
    elif a.cmd == "mix": mix(a)
    elif a.cmd == "license": license(a)
    else:
        ids = search(a); res = analyze(a, ids[:4])
        if not res: sys.exit("no candidate downloaded")
        a.music = res[0][2]; print(f"selected {res[0][1]} (flattest energy profile)"); mix(a)

if __name__ == "__main__":
    main()
