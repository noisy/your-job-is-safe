"""Word-level forced alignment of the known lyrics -> data/lyrics.json.

Pipeline (run ctc_emissions.py and whisper_run.py first):
1. Emissions of two char-level CTC models (MMS_FA, wav2vec2 LV60K) are mapped to one alphabet
   (blank, a-z, ') and fused as a probability mixture.
2. All lines are aligned in ONE Viterbi pass over the whole song. A "garbage" star token sits
   between lines (and at both ends); its per-frame score is (best token log-prob - margin), so it
   absorbs the solo, ad-libs and backing vocals, while lyric words win wherever they really match.
   (Global star-token CTC alignment after pdoom-video's ctcalign.py, Giacomo Magnanini, MIT.)
3. Word ends: CTC emits blanks through held vowels, so a word's end is pushed forward through the
   sustained vocal energy (vocal-stem RMS), never past the next word's start.
4. Cross-check: Whisper word timestamps are matched to the aligned words (sequence match on the
   normalised text). A low-confidence CTC word takes Whisper's start when that start is voiced and
   fits between its neighbours (refine_with_whisper). Words whose starts still disagree by more
   than 0.25 s are flagged in qa/align_report.txt.

Usage: python align.py [--models mms,lv60k] [--margin 1.5]
"""
import common
import argparse
import difflib
import json
import re
import numpy as np
import numba
import torchaudio

FRAME = 0.02
ALPHA = ["-"] + list("abcdefghijklmnopqrstuvwxyz'")
AIDX = {c: i for i, c in enumerate(ALPHA)}

# How words are pronounced (subwords as the model would spell what it hears). Keys are normalised
# display words (lowercase, no punctuation except apostrophes and hyphens).
PRON = {
    "ai": ["ay", "eye"],
    "r's": ["ars"],
    "drive-thru": ["drive", "through"],
    "tiktok": ["tick", "tock"],
    "waymo": ["way", "mo"],
    "twenty-one": ["twenty", "one"],
    "twenty-ten": ["twenty", "ten"],
    "hand-typing": ["hand", "typing"],
    "hands-free": ["hands", "free"],
    "grok": ["grock"],
}


def norm(word):
    return re.sub(r"[^a-z'\-]", "", word.lower().replace("’", "'")).strip("'-")


def pron(word):
    n = norm(word)
    if n in PRON:
        return PRON[n]
    return [p for p in re.split(r"-", n) if p]


def tokenize(text):
    """Display words of a line: whitespace split, standalone dashes dropped, leading ellipses removed."""
    out = []
    for w in text.split():
        if re.fullmatch(r"[-–—]+", w):
            continue
        w = re.sub(r"^\.\.\.", "", w)
        if norm(w):
            out.append(w)
    return out


def common_logp(model):
    em = np.load(common.WORK / f"emission_{model}.npy").astype(np.float64)
    if model == "mms":
        labs = list(torchaudio.pipelines.MMS_FA.get_labels(star=None))
    else:
        labs = list(torchaudio.pipelines.WAV2VEC2_ASR_LARGE_LV60K_960H.get_labels())
    out = np.full((em.shape[0], len(ALPHA)), -1e4)
    blank_cols = [labs.index("-")] + ([labs.index("|")] if "|" in labs else [])
    out[:, 0] = np.logaddexp.reduce(em[:, blank_cols], axis=1)
    for i, c in enumerate(labs):
        k = c.lower()
        if k in AIDX and k != "-":
            out[:, AIDX[k]] = em[:, i]
    out -= np.logaddexp.reduce(out, axis=1, keepdims=True)
    return out


def fused(models):
    es = [common_logp(m) for m in models]
    n = min(len(e) for e in es)
    return np.logaddexp.reduce(np.stack([e[:n] for e in es]), axis=0) - np.log(len(es))


@numba.njit(cache=True)
def viterbi(E, tgt):
    T, L = E.shape[0], len(tgt)
    S = 2 * L + 1
    NEG = -1e18
    prev = np.full(S, NEG)
    cur = np.full(S, NEG)
    bp = np.zeros((T, S), np.int8)  # 0 stay, 1 from s-1, 2 from s-2
    prev[0] = E[0, 0]
    prev[1] = E[0, tgt[0]]
    for t in range(1, T):
        for s in range(S):
            e = E[t, tgt[(s - 1) // 2]] if s % 2 == 1 else E[t, 0]
            best, arg = prev[s], 0
            if s >= 1 and prev[s - 1] > best:
                best, arg = prev[s - 1], 1
            if s >= 2 and s % 2 == 1:
                j = (s - 1) // 2
                if tgt[j] != tgt[j - 1] and prev[s - 2] > best:
                    best, arg = prev[s - 2], 2
            cur[s] = best + e
            bp[t, s] = arg
        for s in range(S):
            prev[s] = cur[s]
    s = S - 1 if prev[S - 1] >= prev[S - 2] else S - 2
    path = np.zeros(T, np.int64)
    for t in range(T - 1, -1, -1):
        path[t] = s
        s -= bp[t, s]
    return path


def align(E, lines, margin):
    star = len(ALPHA)
    tgt, index = [star], []
    for li, words in enumerate(lines):
        for wi, w in enumerate(words):
            for sw in pron(w):
                a = len(tgt)
                tgt.extend(AIDX[c] for c in sw if c in AIDX)
                index.append((li, wi, a, len(tgt)))
        tgt.append(star)
    Ex = np.concatenate([E, E.max(axis=1, keepdims=True) - margin], axis=1)
    tgt = np.array(tgt, np.int64)
    path = viterbi(Ex, tgt)
    tokpos = np.where(path % 2 == 1, (path - 1) // 2, -1)
    P = np.exp(Ex[np.arange(len(path)), np.where(tokpos >= 0, tgt[np.maximum(tokpos, 0)], 0)])
    spans = {}
    for (li, wi, a, b) in index:
        fr = np.where((tokpos >= a) & (tokpos < b))[0]
        s = spans.setdefault((li, wi), [np.inf, -np.inf, []])
        s[0] = min(s[0], fr.min() * FRAME)
        s[1] = max(s[1], (fr.max() + 1) * FRAME)
        s[2].append(float(P[fr].mean()))
    return spans


def vocal_rms():
    y, sr = common.load_stem("vocals", sr=16000)
    hop = int(FRAME * sr)
    n = len(y) // hop
    r = np.sqrt(np.mean(y[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    return 20 * np.log10(r + 1e-9)


def extend_ends(words, rms_db):
    """Push each word's end through its sustained note (vocal RMS within 12 dB of the word's peak and
    above -45 dBFS), stopping 20 ms before the next word and at most 2.5 s after the CTC end."""
    for i, w in enumerate(words):
        nxt = words[i + 1]["start"] if i + 1 < len(words) else w["end"] + 2.5
        a, b = int(w["start"] / FRAME), max(int(w["end"] / FRAME), int(w["start"] / FRAME) + 1)
        peak = rms_db[a:b].max() if b > a else rms_db[a]
        k = b
        lim = min(int((nxt - 0.02) / FRAME), int((w["end"] + 2.5) / FRAME), len(rms_db) - 1)
        while k < lim and rms_db[k] > max(peak - 12, -45):
            k += 1
        end = max(w["end"], k * FRAME, w["start"] + 0.06)
        if i + 1 < len(words):
            end = max(w["start"] + 0.02, min(end, nxt - 0.01))
        w["end"] = round(end, 3)


def whisper_words(tag):
    p = common.WORK / f"whisper_{tag}.json"
    if not p.exists():
        return []
    res = json.loads(p.read_text())
    return [dict(w=norm(x["word"]), start=float(x["start"]), end=float(x["end"]))
            for seg in res["segments"] for x in seg.get("words", []) if norm(x["word"])]


def cross_check(words, wh):
    a = [norm(w["w"]).replace("-", "") for w in words]
    b = [x["w"].replace("-", "") for x in wh]
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    deltas = {}
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            deltas[blk.a + k] = wh[blk.b + k]["start"] - words[blk.a + k]["start"]
    return deltas


def refine_with_whisper(words, wh, rms_db):
    """A low-confidence CTC word (conf < 0.25) whose start disagrees with Whisper's by > 0.25 s takes
    Whisper's start when that start is voiced (vocal RMS > -40 dBFS 100 ms in) and lies between its
    neighbours. (CTC sometimes parks a word in a held note or a gap; Whisper alone pulls line-initial
    words early into silence, which the voicing test rejects.) Returns the adjusted indices."""
    deltas = cross_check(words, wh)
    changed = []
    for i, d in deltas.items():
        w = words[i]
        if w["conf"] >= 0.25 or abs(d) <= 0.25:
            continue
        ws = w["start"] + d
        lo = words[i - 1]["end"] - 0.05 if i > 0 else 0
        hi = words[i + 1]["start"] - 0.05 if i + 1 < len(words) else ws + 1
        k = int((ws + 0.1) / FRAME)
        if lo <= ws <= hi and k < len(rms_db) and rms_db[k] > -40:
            w["start"] = round(ws, 3)
            w["end"] = round(max(w["end"], ws + 0.08) if w["end"] > ws else min(hi + 0.05, ws + 0.4), 3)
            changed.append(i)
    return changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="mms,lv60k")
    ap.add_argument("--margin", type=float, default=1.5)
    ap.add_argument("--whisper", default="turbo_prompt")
    args = ap.parse_args()

    rows = common.load_lyrics_src()
    sung = [r for r in rows if r["text"]]
    lines = [tokenize(r["text"]) for r in sung]
    E = fused(args.models.split(","))
    spans = align(E, lines, args.margin)

    flat, out_lines = [], []
    for li, (r, words) in enumerate(zip(sung, lines)):
        ws = []
        for wi, w in enumerate(words):
            s0, s1, conf = spans[(li, wi)]
            ws.append(dict(w=w.strip('"'), start=round(s0, 3), end=round(s1, 3), conf=round(float(np.mean(conf)), 3)))
        flat.extend(ws)
        out_lines.append(dict(section=r["section"], text=r["text"], words=ws))
    rms = vocal_rms()
    wh = whisper_words(args.whisper)
    refined = refine_with_whisper(flat, wh, rms) if wh else []
    extend_ends(flat, rms)
    for L in out_lines:
        L["start"], L["end"] = L["words"][0]["start"], L["words"][-1]["end"]

    # events: the laugh sits between the intro's first and second spoken lines
    events = []
    for i, r in enumerate(rows):
        if r["event"]:
            prev_line = next(L for L in reversed(out_lines[: sum(1 for x in rows[:i] if x["text"])]))
            nxt_line = out_lines[sum(1 for x in rows[:i] if x["text"])]
            events.append(dict(name=r["event"], start=prev_line["end"], end=nxt_line["start"]))

    # sections from the lyric structure (solo = gap between chorus2 and breakdown)
    sections = []
    for sec in dict.fromkeys(r["section"] for r in rows):
        ls = [L for L in out_lines if L["section"] == sec]
        if ls:
            sections.append(dict(name=sec, start=ls[0]["start"], end=ls[-1]["end"]))
    ch2 = next(s for s in sections if s["name"] == "chorus2")
    bd = next(s for s in sections if s["name"] == "breakdown")
    sections.insert(sections.index(bd), dict(name="solo", start=ch2["end"], end=bd["start"]))

    (common.DATA / "lyrics.json").write_text(json.dumps(dict(lines=out_lines, events=events, sections=sections), indent=1))

    deltas = cross_check(flat, wh) if wh else {}
    rep = [f"models={args.models} margin={args.margin} words={len(flat)} whisper_matched={len(deltas)}"
           f" refined_from_whisper={[flat[i]['w'] + '@' + str(flat[i]['start']) for i in refined]}"]
    if deltas:
        d = np.array(list(deltas.values()))
        rep.append(f"whisper-ctc start delta: median {np.median(d):+.3f}s  |d|<0.1: {np.mean(np.abs(d) < 0.1):.0%}  |d|<0.25: {np.mean(np.abs(d) < 0.25):.0%}")
    rep.append("")
    i = 0
    for L in out_lines:
        rep.append(f"[{L['section']}] {L['start']:7.2f}-{L['end']:7.2f}  {L['text']}")
        for w in L["words"]:
            d = deltas.get(i)
            flag = "" if d is None else f"  wh{d:+.2f}" + ("  <<<" if abs(d) > 0.25 else "")
            low = "  LOWCONF" if w["conf"] < 0.2 else ""
            rep.append(f"    {w['start']:7.2f} {w['end']:7.2f} {w['conf']:.2f}  {w['w']}{flag}{low}")
            i += 1
    (common.QA / "align_report.txt").write_text("\n".join(rep))
    print("\n".join(rep[:2]))
    print(f"sections: " + ", ".join(f"{s['name']} {s['start']:.2f}" for s in sections))


if __name__ == "__main__":
    main()
