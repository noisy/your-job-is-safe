"""QA plot: vocal-stem waveform + spectrogram with aligned words, beats and drum hits over a time range.
Usage: python qa_plot.py <from> <to> [out.png]"""
import common
import json
import sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import librosa
import librosa.display

t0, t1 = float(sys.argv[1]), float(sys.argv[2])
out = sys.argv[3] if len(sys.argv) > 3 else str(common.QA / f"qa_{t0:.0f}-{t1:.0f}.png")
y, sr = common.load_stem("vocals", sr=22050)
seg = y[int(t0 * sr): int(t1 * sr)]
lyr = json.loads((common.DATA / "lyrics.json").read_text())
au = json.loads((common.DATA / "audio.json").read_text())
fig, (a1, a2) = plt.subplots(2, 1, figsize=(22, 7), sharex=True, gridspec_kw=dict(height_ratios=[1, 2]))
tt = t0 + np.arange(len(seg)) / sr
a1.plot(tt, seg, lw=0.3, color="k")
S = librosa.amplitude_to_db(np.abs(librosa.stft(seg, n_fft=1024, hop_length=128)), ref=np.max)
librosa.display.specshow(S, sr=sr, hop_length=128, x_axis="time", y_axis="log", ax=a2, cmap="magma")
a2.set_xticks([])
for ax in (a1, a2):
    for b in au["beats"]:
        if t0 <= b <= t1:
            ax.axvline(b, color="#888", lw=0.5, ls=":")
    for d in au["downbeats"]:
        if t0 <= d <= t1:
            ax.axvline(d, color="#06c", lw=1.2)
for L in lyr["lines"]:
    for w in L["words"]:
        if w["end"] < t0 or w["start"] > t1:
            continue
        a1.axvspan(w["start"], w["end"], color="#e5322d", alpha=0.15)
        a1.axvline(w["start"], color="#e5322d", lw=0.8)
        a1.text(w["start"], a1.get_ylim()[1] * 0.85, w["w"], fontsize=9, rotation=0, color="#900")
for k, c in [("kick", "#0a0"), ("snare", "#c60")]:
    for t, s in au["onsets"][k]:
        if t0 <= t <= t1:
            a1.plot([t], [a1.get_ylim()[0] * 0.9], "^", color=c, ms=6)
# specshow's time axis starts at 0: shift the spectrogram to song time
for im in a2.collections:
    im.set_transform(matplotlib.transforms.Affine2D().translate(t0, 0) + a2.transData)
a1.set_xlim(t0, t1)
a1.set_title(f"vocals {t0:.2f}-{t1:.2f}s: words (red), beats (dotted), downbeats (blue), kick (green) / snare (orange)")
plt.tight_layout()
plt.savefig(out, dpi=80)
print(out)
