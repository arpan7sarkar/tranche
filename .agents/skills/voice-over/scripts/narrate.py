"""Turn a script into narration: one WAV per passage, and all of them joined with pauses.

Run it with the Kokoro venv's Python, with VIRTUAL_ENV set to the venv:

    VIRTUAL_ENV=~/.venvs/kokoro ~/.venvs/kokoro/bin/python narrate.py script.txt --voice bm_george --out narration/

The script is plain text: one passage per paragraph (separate passages with a blank line). Write
passages, not one line per caption: a narrator speaks in runs of several sentences. Writes
<out>/NN.wav per passage, <out>/narration.wav (the passages joined by --pause seconds of
silence), and <out>/passages.json (each passage's text, file and length).
"""

import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro import KPipeline

SR = 24000
ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
ap.add_argument("script", type=Path)
ap.add_argument("--voice", default="bm_george", help="a Kokoro voice (the first letter is the language)")
ap.add_argument("--speed", type=float, default=1.0)
ap.add_argument("--pause", type=float, default=0.8, help="silence between passages in narration.wav (s)")
ap.add_argument("--out", type=Path, default=Path("narration"))
args = ap.parse_args()

passages = [" ".join(p.split()) for p in args.script.read_text().split("\n\n") if p.strip()]
args.out.mkdir(parents=True, exist_ok=True)
pipe = KPipeline(lang_code=args.voice[0], repo_id="hexgrad/Kokoro-82M")
joined, meta = [], []
for i, text in enumerate(passages):
    audio = np.concatenate([np.asarray(a) for _, _, a in pipe(text, voice=args.voice, speed=args.speed)])
    path = args.out / f"{i:02d}.wav"
    sf.write(path, audio, SR)
    meta.append({"text": text, "wav": str(path), "seconds": round(len(audio) / SR, 2)})
    joined += [audio, np.zeros(int(args.pause * SR), dtype=audio.dtype)]
    print(f"{i:02d}  {len(audio) / SR:5.1f} s  {text[:70]}")
sf.write(args.out / "narration.wav", np.concatenate(joined[:-1]) if joined else np.zeros(1), SR)
(args.out / "passages.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False))
print(f"{args.out / 'narration.wav'}: {sum(m['seconds'] for m in meta) + args.pause * max(len(meta) - 1, 0):.1f} s")
