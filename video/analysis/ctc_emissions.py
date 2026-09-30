"""Frame-wise CTC log-probabilities (20 ms frames) of the Demucs vocal stem.

Two acoustic models give two independent alignments (approach after pdoom-video by Giacomo Magnanini, MIT):
  mms   : torchaudio MMS_FA (multilingual romanised characters, trained for forced alignment)
  lv60k : torchaudio WAV2VEC2_ASR_LARGE_LV60K_960H (English characters)
Emissions are computed on overlapping chunks with context, stitched, and cached to
work/emission_<model>.npy (shape [frames, vocab]).
"""
import common
import sys
import numpy as np
import torch
import torchaudio

HOP = 320  # samples at 16 kHz -> 20 ms


def compute(name, chunk_s=20.0, ctx_s=3.0):
    bundle = {"mms": torchaudio.pipelines.MMS_FA,
              "lv60k": torchaudio.pipelines.WAV2VEC2_ASR_LARGE_LV60K_960H}[name]
    model = bundle.get_model(with_star=False) if name == "mms" else bundle.get_model()
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = model.to(device).eval()
    y, _ = common.load_stem("vocals", sr=16000)
    y = y / (np.abs(y).max() + 1e-9)
    n_frames = len(y) // HOP
    chunk, ctx = int(chunk_s * 16000), int(ctx_s * 16000)
    out = None
    for s in range(0, len(y), chunk):
        a, b = max(0, s - ctx), min(len(y), s + chunk + ctx)
        x = torch.from_numpy(y[a:b]).float()[None].to(device)
        with torch.inference_mode():
            em, _ = model(x)
            em = torch.log_softmax(em, dim=-1)[0].float().cpu().numpy()
        if out is None:
            out = np.full((n_frames, em.shape[1]), np.nan, np.float32)
        f0 = a // HOP
        lo, hi = s // HOP, min(n_frames, (s + chunk) // HOP)
        seg = em[lo - f0: hi - f0]
        out[lo: lo + len(seg)] = seg
    last = np.where(~np.isnan(out[:, 0]))[0].max()
    out[last + 1:] = out[last]
    np.save(common.WORK / f"emission_{name}.npy", out)
    print(name, out.shape, "labels", len(bundle.get_labels()))


if __name__ == "__main__":
    for n in sys.argv[1:] or ["mms", "lv60k"]:
        compute(n)
