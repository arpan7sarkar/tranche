"""Render the same lines in several Kokoro voices, to listen to side by side before choosing.

Run it with the Kokoro venv's Python, with VIRTUAL_ENV set to the venv:

    VIRTUAL_ENV=~/.venvs/kokoro ~/.venvs/kokoro/bin/python audition.py --out auditions/
    ... --voices bm_george,am_michael,af_heart --speed 1.0 --text "Your own line. Another one."

Writes <out>/<voice>.wav per voice. Use a line from the actual script: a voice that reads a
tagline well can still stumble on your product's jargon.
"""

import argparse
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro import KPipeline

ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
ap.add_argument("--voices", default="bm_george,am_michael,af_heart,bf_emma",
                help="comma-separated Kokoro voices (the first letter is the language: a American, b British)")
ap.add_argument("--text", default="This is a real recording of the app. Every frame you see came from the app itself.")
ap.add_argument("--speed", type=float, default=1.0)
ap.add_argument("--out", type=Path, default=Path("auditions"))
args = ap.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
pipes: dict[str, KPipeline] = {}  # one pipeline per language, shared by its voices
for voice in args.voices.split(","):
    voice = voice.strip()
    if voice[0] not in pipes:
        pipes[voice[0]] = KPipeline(lang_code=voice[0], repo_id="hexgrad/Kokoro-82M")
    pipe = pipes[voice[0]]
    audio = np.concatenate([np.asarray(a) for _, _, a in pipe(args.text, voice=voice, speed=args.speed)])
    sf.write(args.out / f"{voice}.wav", audio, 24000)
    print(f"{voice:12s} {len(audio) / 24000:5.1f} s  {args.out / (voice + '.wav')}")
