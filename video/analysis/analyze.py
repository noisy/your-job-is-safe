"""Music analysis -> data/audio.json (run after Demucs and align.py).

- beats / downbeats: beat_this (CPJKU, final0 checkpoint) on the full mix; the spoken intro has no
  music, so the grid starts at the first detected beat. Tempo = median inter-beat interval.
- drum onsets on the Demucs drum stem, split by band: kick (< 150 Hz), snare (1-5 kHz body+crack,
  with a 150-400 Hz check), hat (> 7 kHz). Each onset carries a 0..1 strength.
- vocal onsets: word starts from data/lyrics.json (the renderer's per-word timing lives there).
- envelopes (`features`) at ENV_RATE Hz (`fps`), 0..1 (99th-percentile normalised): rms (mix), low / mid / high (mix
  bands), and one per stem: vocal, drums, bass, other.
- sections: the lyric sections from data/lyrics.json, stretched so they tile the song
  (intro from 0, robot/outro to the end).
"""
import common
import json
import numpy as np
import librosa
import scipy.signal as sps

ENV_RATE = 100  # Hz


def beats_and_downbeats():
    from beat_this.inference import File2Beats
    import torch
    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    cache = common.WORK / "beat_this.npz"
    if cache.exists():
        z = np.load(cache)
        return z["beats"], z["downbeats"]
    f2b = File2Beats(checkpoint_path="final0", device=dev, dbn=False)
    beats, downbeats = f2b(str(common.MIX_WAV))
    np.savez(cache, beats=np.asarray(beats, float), downbeats=np.asarray(downbeats, float))
    return np.asarray(beats, float), np.asarray(downbeats, float)


# The song is two Suno generations spliced at 3:12.45 (handoff.md): the doorbell guitar and the robot follow.
SPLICE = 192.45


def clean_grid(beats, downbeats, y, sr):
    """Repair the tracker's grid:
    - the half-time bridge is tracked at half tempo: fill the missing off-beats (midpoints);
    - beat_this quantises to 20 ms: smooth each beat with a local linear fit over +-4 beats of a
      regular run (never across the splice);
    - the spoken intro has no music: beats before the music starts are replaced by the grid
      extrapolated backwards from the first real bars (so beat maths still works), and the
      tracker's downbeats there are dropped;
    - downbeats are the tracker's, snapped to the nearest cleaned beat. (The phase shifts by two
      beats at the bridge's 2-beat bar: that is in the song.) Half-time stretches tracked as 8-beat
      bars are split into 4-beat bars; after the splice the bars are rebuilt every 4 beats."""
    med = np.median(np.diff(beats))
    filled = [beats[0]]
    for a, b in zip(beats, beats[1:]):
        if b - a > 1.6 * med:
            k = int(round((b - a) / med))
            filled.extend(a + (b - a) * j / k for j in range(1, k))
        filled.append(b)
    b = np.array(filled)
    sm = b.copy()
    for i in range(len(b)):
        lo, hi = max(0, i - 4), min(len(b), i + 5)
        idx = np.arange(lo, hi)
        seg = b[lo:hi]
        same_side = (seg < SPLICE) == (b[i] < SPLICE)
        idx, seg = idx[same_side], seg[same_side]
        if len(seg) >= 5 and np.all(np.abs(np.diff(seg) - med) < 0.3 * med):
            A = np.vstack([np.ones_like(idx, dtype=float), idx.astype(float)]).T
            c = np.linalg.lstsq(A, seg, rcond=None)[0]
            sm[i] = c[0] + c[1] * i
    # music start: first time the non-vocal stems carry sustained energy
    o, _ = common.load_stem("other", sr=sr)
    dr, _ = common.load_stem("drums", sr=sr)
    hop = sr // ENV_RATE
    e = norm01(band_env(o + dr, sr, 20, 18000, hop))
    run = np.convolve(e > 0.15, np.ones(20), "valid")  # 200 ms sustained
    # the laugh and the spoken lines bleed into the "other" stem: search after the intro's last word
    lyr = json.loads((common.DATA / "lyrics.json").read_text())
    intro_end = max(L["end"] for L in lyr["lines"] if L["section"] == "intro")
    k0 = int(intro_end * ENV_RATE)
    music_start = float((k0 + np.argmax(run[k0:] >= 20)) / ENV_RATE)
    first = np.searchsorted(sm, music_start - 0.05)
    period = np.median(np.diff(sm[first:first + 16]))
    pre = sm[first] - period * np.arange(int(sm[first] / period) + 1, 0, -1)
    pre = pre[pre >= 0]
    sm = np.concatenate([pre, sm[first:]])
    bi = sorted({int(np.argmin(np.abs(sm - d))) for d in downbeats if music_start - 0.05 <= d < SPLICE})
    # half-time stretches (the bridge, the start of the final chorus) are tracked as 8-beat bars: split them
    full = [bi[0]]
    for a, b in zip(bi, bi[1:]):
        k = int(round((b - a) / 4))
        full.extend(a + 4 * j for j in range(1, k) if b - (a + 4 * j) >= 2)
        full.append(b)
    # after the splice the tracker's downbeats follow single beats: bars every 4 beats, phased to the
    # first regular pair of tracked downbeats after it
    tail = [int(np.argmin(np.abs(sm - d))) for d in downbeats if d > SPLICE]
    anchor = next((x for x, y in zip(tail, tail[1:]) if y - x == 4), None)
    if anchor is not None:
        first = int(np.searchsorted(sm, SPLICE))
        full.extend(i for i in range(anchor - 4 * ((anchor - first) // 4), len(sm), 4) if i > full[-1])
    db = [float(sm[i]) for i in sorted(set(full)) if i < len(sm)]
    return sm, np.array(db), music_start


def drum_hits(sr):
    """Kick / snare / hat hits on the Demucs drum stem. Onsets come from librosa's spectral flux on the
    stem (5 ms hops); each onset is classified by how much each band's energy jumps across it (the 30 ms
    after vs the 20 ms before): kick = sub (30-120 Hz), snare = body (150-300 Hz) plus crack (1.5-5 kHz),
    hat = air (7-16 kHz) without the crack. One onset can be a kick and a hat at once. Strength 0..1 per kind."""
    d, _ = common.load_stem("drums", sr=sr)
    hop = 220
    S = np.abs(librosa.stft(d, n_fft=2048, hop_length=hop)) ** 2
    fr = librosa.fft_frequencies(sr=sr, n_fft=2048)
    band = lambda lo, hi: S[(fr >= lo) & (fr < hi)].sum(axis=0) + 1e-9
    B = dict(sub=band(30, 120), body=band(150, 300), crack=band(1500, 5000), air=band(7000, 16000))
    env = librosa.onset.onset_strength(S=librosa.power_to_db(S), sr=sr, hop_length=hop)
    on = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=hop, backtrack=False,
                                    pre_max=3, post_max=3, pre_avg=10, post_avg=10, delta=0.08, wait=12)
    fps = sr / hop
    pre, post = int(0.02 * fps), int(0.03 * fps)
    jump = {k: [] for k in B}
    level = {k: [] for k in B}
    for f in on:
        for k, v in B.items():
            a = v[max(0, f - pre):f].mean() if f > 0 else v[0]
            b = v[f:f + post].max()
            jump[k].append(10 * np.log10(b / a))
            level[k].append(b)
    J = {k: np.array(v) for k, v in jump.items()}
    Lv = {k: np.array(v) / np.percentile(v, 98) for k, v in level.items()}
    t = librosa.frames_to_time(on, sr=sr, hop_length=hop)
    kick, snare, hat = [], [], []
    for i, ti in enumerate(t):
        ti = round(float(ti), 3)
        is_kick = J["sub"][i] > 6 and Lv["sub"][i] > 0.15
        if is_kick:
            kick.append(dict(t=ti, s=float(min(1, Lv["sub"][i]))))
        # this mix's snare is mostly body (little crack): a hit without kick-level sub whose body jumps
        if not is_kick and J["body"][i] > 3.5 and Lv["body"][i] > 0.3:
            snare.append(dict(t=ti, s=float(min(1, Lv["body"][i] * (1 + 0.1 * max(0, J["crack"][i]))))))
        elif not is_kick and J["air"][i] > 3 and Lv["air"][i] > 0.08:
            hat.append(dict(t=ti, s=float(min(1, Lv["air"][i]))))
    r3 = lambda evs: [dict(t=e["t"], s=round(e["s"], 3)) for e in evs]
    return r3(kick), r3(snare), r3(hat)


def band_env(y, sr, lo, hi, hop):
    sos = sps.butter(4, [lo, hi] if lo > 0 else hi, btype="bandpass" if lo > 0 else "lowpass", fs=sr, output="sos")
    z = sps.sosfiltfilt(sos, y)
    n = len(z) // hop
    return np.sqrt(np.mean(z[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)


def norm01(x, pct=99.0):
    top = np.percentile(x, pct) + 1e-12
    return np.clip(x / top, 0, 1)


def onsets_from_env(env, rate, min_gap, thresh):
    """Peaks of the positive log-envelope flux, strength 0..1."""
    le = np.log(env + 1e-6)
    flux = np.maximum(0, np.diff(le, prepend=le[0]))
    flux = sps.savgol_filter(flux, 5, 2) if len(flux) > 7 else flux
    flux = np.maximum(flux, 0)
    peaks, props = sps.find_peaks(flux, height=thresh * flux.max(), distance=max(1, int(min_gap * rate)))
    h = props["peak_heights"]
    return [dict(t=round(p / rate, 3), s=round(float(v / h.max()), 3)) for p, v in zip(peaks, h)]


def gate_by_level(events, env, rate, min_level):
    lvl = norm01(env)
    return [e for e in events if lvl[min(len(lvl) - 1, int(e["t"] * rate) + 2)] > min_level]


def main():
    y, sr = common.load_mix(sr=common.SR)
    dur = len(y) / sr
    hop = sr // ENV_RATE

    beats, downbeats = beats_and_downbeats()
    beats, downbeats, music_start = clean_grid(beats, downbeats, y, sr)
    ibi = np.diff(beats)
    tempo = 60 / np.median(ibi)

    kick, snare, hat = drum_hits(sr)

    envs = {
        "rms": band_env(y, sr, 20, 18000, hop),
        "low": band_env(y, sr, 0, 200, hop),
        "mid": band_env(y, sr, 200, 3000, hop),
        "high": band_env(y, sr, 3000, 16000, hop),
    }
    for name, stem in [("vocal", "vocals"), ("drums", "drums"), ("bass", "bass"), ("other", "other")]:
        s, _ = common.load_stem(stem, sr=sr)
        envs[name] = band_env(s, sr, 20, 18000, hop)
    n = min(len(v) for v in envs.values())
    envs = {k: [round(float(x), 3) for x in norm01(v[:n])] for k, v in envs.items()}

    lyr = json.loads((common.DATA / "lyrics.json").read_text())
    vocal_onsets = [dict(t=w["start"], s=1.0) for L in lyr["lines"] for w in L["words"]]

    secs = [dict(s) for s in lyr["sections"]]
    secs[0]["start"] = 0.0
    for a, b in zip(secs, secs[1:]):
        a["end"] = b["start"]
    secs[-1]["end"] = dur

    pairs = lambda evs: [[e["t"], e["s"]] for e in evs]
    out = dict(
        duration=round(dur, 4), bpm=round(float(tempo), 3), fps=ENV_RATE,
        musicStart=round(music_start, 3), splice=SPLICE,
        beats=[round(float(b), 4) for b in beats], downbeats=[round(float(b), 4) for b in downbeats],
        sections=[dict(name=s["name"], start=round(s["start"], 3), end=round(s["end"], 3)) for s in secs],
        onsets=dict(kick=pairs(kick), snare=pairs(snare), hat=pairs(hat), vocal=pairs(vocal_onsets)),
        features=envs,
    )
    (common.DATA / "audio.json").write_text(json.dumps(out, separators=(",", ":")))
    bars = np.diff(downbeats)
    print(f"duration {dur:.2f}s tempo {tempo:.2f} BPM beats {len(beats)} downbeats {len(downbeats)} "
          f"(bar median {np.median(bars):.3f}s, beats/bar ~{np.median(bars) / np.median(ibi):.2f})")
    print(f"music starts {music_start:.2f}s; first beat {beats[0]:.3f} first downbeat {downbeats[0]:.3f} last beat {beats[-1]:.3f}")
    print(f"kick {len(kick)} snare {len(snare)} hat {len(hat)}")
    print("sections:", ", ".join(f"{s['name']} {s['start']:.2f}" for s in secs))


if __name__ == "__main__":
    main()
