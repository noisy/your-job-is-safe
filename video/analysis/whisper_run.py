"""Whisper word timestamps (mlx-whisper, large-v3-turbo) on the vocal stem.

An independent cross-check for the CTC forced alignment in align.py. Writes work/whisper_<tag>.json.
"""
import common
import json
import sys
import mlx_whisper
import soundfile as sf

MODELS = {"turbo": "mlx-community/whisper-large-v3-turbo", "large": "mlx-community/whisper-large-v3-mlx"}
PROMPT = ("Pop-punk song lyrics: strawberry, semicolon, spaghetti, Fresh Prince, jiggy, Windows keys, "
          "Hamilton, Grok, Waymo, TikTok, nuggets, masterstroke, Tesla, plumber, slop machine.")


def run(tag, model, prompt=None):
    wav = common.WORK / "vocals16k.wav"
    if not wav.exists():
        y, sr = common.load_stem("vocals", sr=16000)
        sf.write(str(wav), y, sr)
    res = mlx_whisper.transcribe(
        str(wav), path_or_hf_repo=model, language="en", word_timestamps=True,
        condition_on_previous_text=False, initial_prompt=prompt, temperature=0.0,
    )
    (common.WORK / f"whisper_{tag}.json").write_text(json.dumps(res, indent=1, default=float))
    for seg in res["segments"]:
        print(f"{seg['start']:7.2f} {seg['end']:7.2f} {seg['text']}")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "turbo"
    run(which + "_prompt", MODELS[which], PROMPT)
