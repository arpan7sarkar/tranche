#!/usr/bin/env bash
# Set up Kokoro-82M (local text-to-speech) in its own Python 3.12 venv, CPU only, and say one line.
#
#   bash setup_kokoro.sh            # into ~/.venvs/kokoro, or $KOKORO_VENV when set
#
# Python 3.12 because PyTorch has no wheels for the newest Pythons; uv fetches 3.12 without
# touching your system Python. CPU PyTorch is plenty for narration and far smaller than the
# CUDA build (which the default index resolves to, at several GB). The model (about 330 MB) and a
# small spaCy model download on the first line, from Hugging Face and GitHub.
set -euo pipefail
VENV="${KOKORO_VENV:-$HOME/.venvs/kokoro}"
command -v uv >/dev/null || { echo "uv is not on PATH: https://docs.astral.sh/uv/" >&2; exit 1; }
# espeak-ng (bundled, for words outside Kokoro's dictionary) keeps its data path in a 160-byte
# buffer: a longer path is cut short, it falls back to a path from the packager's build machine,
# and the process exits with "Error processing file ... phontab". Keep the venv's path short.
DATA="$VENV/lib/python3.12/site-packages/espeakng_loader/espeak-ng-data"
if [ "${#DATA}" -gt 150 ]; then
  echo "KOKORO_VENV is too deep ($VENV): espeak-ng can't use a data path of ${#DATA} characters." >&2
  echo "Put the venv somewhere short, such as ~/.venvs/kokoro." >&2
  exit 1
fi
uv venv --python 3.12 "$VENV"
uv pip install --python "$VENV/bin/python" --index-url https://download.pytorch.org/whl/cpu torch
uv pip install --python "$VENV/bin/python" "kokoro>=0.9.4" soundfile
# Kokoro's G2P installs its spaCy model through uv the first time: it needs VIRTUAL_ENV set
OUT="$(mktemp -d)"
VIRTUAL_ENV="$VENV" PATH="$VENV/bin:$PATH" "$VENV/bin/python" - "$OUT/hello.wav" <<'PY'
import sys
import numpy as np, soundfile as sf
from kokoro import KPipeline
pipe = KPipeline(lang_code="b", repo_id="hexgrad/Kokoro-82M")
audio = np.concatenate([np.asarray(a) for _, _, a in pipe("The voice is ready.", voice="bm_george")])
sf.write(sys.argv[1], audio, 24000)
print(f"said one line: {len(audio) / 24000:.1f} s")
PY
rm -rf "$OUT"
echo "Kokoro is ready in $VENV"
