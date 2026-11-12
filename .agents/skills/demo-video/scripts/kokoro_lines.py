"""Synthesize narration lines with Kokoro-82M. Run it with the Kokoro venv's Python, with
VIRTUAL_ENV set to that venv (demo_video.sound does both):

    python kokoro_lines.py spec.json

spec.json: {"voice": "bm_george", "speed": 1.0, "lines": [{"text": "...", "wav": "/abs/path.wav"}, ...]}
A voice's first letter is its language: a (American English), b (British English), and so on.
"""

import json
import sys

import numpy as np
import soundfile as sf
from kokoro import KPipeline

spec = json.load(open(sys.argv[1]))
voice = spec["voice"]
pipe = KPipeline(lang_code=voice[0], repo_id="hexgrad/Kokoro-82M")
for item in spec["lines"]:
    audio = np.concatenate([np.asarray(a) for _, _, a in pipe(item["text"], voice=voice, speed=spec["speed"])])
    sf.write(item["wav"], audio, 24000)
    print(f"{len(audio) / 24000:5.2f} s  {item['text'][:70]}", flush=True)
