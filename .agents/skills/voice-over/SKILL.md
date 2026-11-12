---
name: voice-over
description: Local text-to-speech narration with Kokoro-82M. Sets up its Python 3.12 venv (CPU), auditions voices side by side, turns a script into WAV files, and gives the levels for mixing narration with music (-16 / -23 LUFS, no ducking). Use when asked for a voice-over, narration, text-to-speech or a voice audition, or when the demo-video skill needs a voice.
---

# Voice-over

Narration made on this machine with Kokoro-82M (Apache-2.0): no audio or script leaves it. Paths below are relative to this skill's folder.

## Set up once

```bash
bash scripts/setup_kokoro.sh          # into ~/.venvs/kokoro (or $KOKORO_VENV), then says one line
```

- Kokoro needs its own **Python 3.12** venv: PyTorch has no wheels for the newest Pythons, and `pip install kokoro` then fails building from source. The script gets 3.12 through uv without touching the system Python.
- It installs **CPU PyTorch**: plenty for narration, and a fraction of the CUDA build's several gigabytes.
- The first line downloads the model (about 330 MB, from Hugging Face) and a small spaCy model (through uv, which needs `VIRTUAL_ENV` set to the venv; every script here sets it).
- **Keep the venv's path short.** The bundled espeak-ng keeps its data path in a 160-byte buffer: from a deep folder it falls back to a path from its packager's build machine and exits with `Error processing file '…/phontab'`. The script refuses a path that's too long.

Every script below runs with the venv's Python and `VIRTUAL_ENV` set:

```bash
export VIRTUAL_ENV=~/.venvs/kokoro
$VIRTUAL_ENV/bin/python scripts/audition.py --out auditions/
```

## Pick a voice

```bash
$VIRTUAL_ENV/bin/python scripts/audition.py --voices bm_george,am_michael,af_heart,bf_emma \
    --text "A line from the real script." --out auditions/
```

Send the person the WAVs and let them choose: a voice is a taste call. Use a line from the actual script, since a voice that reads a tagline well can still stumble on product jargon. A voice's first letter is its language (`a` American English, `b` British English). In earlier auditions `bm_george` (British male) was picked twice and `am_michael` (American male) was the runner-up both times; Piper's voices sounded unnatural next to them. Speed 1.0 is calm; 1.1–1.15 suits a brisk walkthrough.

## Narrate a script

```bash
$VIRTUAL_ENV/bin/python scripts/narrate.py script.txt --voice bm_george --speed 1.0 --out narration/
```

The script is plain text, one passage per paragraph. You get `NN.wav` per passage, `narration.wav` (all of them, joined by short pauses) and `passages.json` (each passage's length, for timing the picture to the voice).

**Write passages, not captions.** A narrator speaks in runs of two or three sentences that span several moments of the picture. One short line per caption, with dead air between them, sounds like someone reading captions aloud. Read URLs off the screen ("the link's on screen"), never aloud.

For a demo video, don't narrate separately: put the passages in the take's `captions.json` and let the `demo-video` skill's `edit.py --voice` place them on the shots.

## Mixing with music

- The voice at one static gain to about **-16 LUFS**, the music at one steady level about **-23 LUFS**: about 7 dB apart. Measure integrated loudness (EBU R128), which ignores the silence between lines.
- **No ducking.** Dipping the music under each line was tried and rejected.
- Let the music play **alone for a lead-in**, and start the first line on a pause in the track.
- Keep the stems separate (`narration.wav`, `music.wav`) and mix last.
- **Approve audio as audio:** send the mix (and stems) for a listen before any video is rendered.
- Use music you're allowed to use, and carry its credit line (Creative Commons Attribution requires one).
