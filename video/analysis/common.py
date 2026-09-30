"""Shared paths and cache setup for the analysis scripts.

Import this module FIRST (before torch / huggingface / mlx) so every model download lands in
analysis/.cache/ (delete that folder afterwards to reclaim the space).

Time reference: the gapless ffmpeg decode of the mp3 (work/mix.wav), which is also what the
browser plays. Demucs runs on that WAV, so the stems need no offset correction.
"""
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent          # video/analysis/
VIDEO = ROOT.parent                              # video/
CACHE = ROOT / ".cache"
for var, sub in [("TORCH_HOME", "torch"), ("HF_HOME", "hf"), ("HF_HUB_CACHE", "hf/hub"),
                 ("XDG_CACHE_HOME", "xdg"), ("MPLCONFIGDIR", "mpl"), ("NUMBA_CACHE_DIR", "numba")]:
    os.environ.setdefault(var, str(CACHE / sub))
    (CACHE / sub).mkdir(parents=True, exist_ok=True)

AUDIO = VIDEO / "audio" / "song.mp3"
WORK = ROOT / "work"
MIX_WAV = WORK / "mix.wav"
STEMS = ROOT / "stems" / "htdemucs_ft" / "mix"
LYRICS_SRC = VIDEO / "lyrics" / "lyrics.src.txt"
DATA = VIDEO / "data"
QA = ROOT / "qa"
for d in (WORK, DATA, QA):
    d.mkdir(exist_ok=True)

SR = 44100


def load_lyrics_src():
    """Parse lyrics.src.txt -> list of dicts {section, text, event}. Event rows ([laugh]) keep text=None."""
    rows, section = [], None
    for raw in LYRICS_SRC.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("# "):
            continue
        if line.startswith("## "):
            section = line[3:].strip()
            continue
        m = re.fullmatch(r"\[(\w+)\]", line)
        rows.append(dict(section=section, text=None if m else line, event=m.group(1) if m else None))
    return rows


def load_wav(path, sr=None, mono=True):
    import numpy as np
    import soundfile as sf
    y, s = sf.read(str(path), dtype="float32", always_2d=True)
    y = y.mean(axis=1) if mono else y.T
    if sr and sr != s:
        import soxr
        y = soxr.resample(y, s, sr) if mono else np.stack([soxr.resample(c, s, sr) for c in y])
        s = sr
    return y, s


def load_stem(name, sr=None, mono=True):
    return load_wav(STEMS / f"{name}.wav", sr=sr, mono=mono)


def load_mix(sr=None, mono=True):
    return load_wav(MIX_WAV, sr=sr, mono=mono)
