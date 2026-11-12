"""Narration and music for a cut.

Narration is synthesized locally by Kokoro-82M, which runs in its own Python 3.12 venv
(KOKORO_VENV, default ~/.venvs/kokoro; the voice-over skill sets it up), as a subprocess: this
module never imports it. Spoken passages span several beats, and the beats under a passage
stretch to fit it. The music bed sits at one steady level under the voice (music about -23 LUFS,
voice about -16), with no ducking, and plays alone for a lead-in before the first line.

Everything is written as separate stems (narration.wav, music.wav) and their sum (mix.wav),
so the sound can be approved on its own before any video is rendered.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

if TYPE_CHECKING:
    from .cut import Shot

SR = 48000
GAP = 0.4               # s of quiet after a passage, at least, before the next shot's line
MUSIC_FADE_IN = 0.8     # s
MUSIC_FADE_OUT = 2.5    # s
HERE = Path(__file__).resolve().parent.parent  # the scripts folder (kokoro_lines.py)


def kokoro_venv() -> Path:
    return Path(os.environ.get("KOKORO_VENV", "~/.venvs/kokoro")).expanduser()


def warn(*a: Any) -> None:
    print("warning:", *a, file=sys.stderr, flush=True)


def decode(path: Path | str, start: float = 0.0, dur: float | None = None) -> np.ndarray:
    """A file's audio as float32 stereo at SR, via ffmpeg."""
    args = ["ffmpeg", "-v", "error", "-ss", f"{start:.3f}"] + (["-t", f"{dur:.3f}"] if dur else []) + \
        ["-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"]
    raw = subprocess.run(args, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


def write_wav(path: Path, pcm: np.ndarray) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-i", "-",
                    "-c:a", "pcm_s16le", str(path)], input=pcm.astype("float32").tobytes(), check=True)


def lufs(path: Path) -> float | None:
    """Integrated loudness (EBU R128: the silence between lines doesn't count)."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128", "-f", "null", "-"],
                       capture_output=True, text=True)
    m = re.findall(r"I:\s+(-?[\d.]+) LUFS", r.stderr)
    return float(m[-1]) if m else None


def _gain(pcm: np.ndarray, target: float, scratch: Path) -> np.ndarray:
    """pcm at one static gain that brings its integrated loudness to `target` LUFS."""
    write_wav(scratch, pcm)
    level = lufs(scratch)
    scratch.unlink()
    if level is None or level < -70:
        return pcm
    return pcm * (10 ** ((target - level) / 20))


# ------------------------------------------------------------------ narration
def synth(texts: list[str], voice: str, speed: float, cache: Path) -> list[Path]:
    """One WAV per text, by Kokoro, cached by (voice, speed, text): a re-render reuses them."""
    venv = kokoro_venv()
    py = venv / "bin" / "python"
    if not py.exists():
        sys.exit(f"no Kokoro venv at {venv}: set it up with the voice-over skill (scripts/setup_kokoro.sh), "
                 "set KOKORO_VENV to yours, or drop --voice")
    cache.mkdir(parents=True, exist_ok=True)
    paths, todo = [], []
    for text in texts:
        p = cache / (hashlib.sha256(f"{voice}|{speed}|{text}".encode()).hexdigest()[:16] + ".wav")
        paths.append(p)
        if not p.exists():
            todo.append({"text": text, "wav": str(p)})
    if todo:
        spec = cache / "pending.json"
        spec.write_text(json.dumps({"voice": voice, "speed": speed, "lines": todo}, indent=1))
        # Kokoro's G2P installs a spaCy model through uv on first use, which needs VIRTUAL_ENV set
        env = dict(os.environ, VIRTUAL_ENV=str(venv), PATH=f"{venv / 'bin'}:{os.environ.get('PATH', '')}")
        r = subprocess.run([str(py), str(HERE / "kokoro_lines.py"), str(spec)], env=env, capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit("Kokoro failed:\n" + (r.stderr or r.stdout)[-3000:])
        spec.unlink()
    return paths


def narrate(shots: list["Shot"], table: dict[str, Any], voice: str, speed: float, out_dir: Path,
            lead_in: float = 4.0) -> list[dict[str, Any]]:
    """Place the spoken passages on the shots. `table` maps a shot key to what is said from that
    shot on: a string, or {"text": ..., "through": <key>} for a passage running through a later
    shot ("end" runs to the last one). The first line waits for the music's lead-in. Shots
    stretch evenly when a passage needs more room than its beats have. Returns the lines, each
    with "at" (its start, s) and "dur"."""
    first: dict[str, int] = {}
    last: dict[str, int] = {}
    for i, s in enumerate(shots):
        if s.key:
            first.setdefault(s.key, i)
            last[s.key] = i
    lines: list[dict[str, Any]] = []
    for key, spec in table.items():
        if key not in first:
            warn(f"narration passage {key!r}: no shot has that key, so it is left out")
            continue
        text, through = (spec, key) if isinstance(spec, str) else (spec["text"], spec.get("through", key))
        end = len(shots) - 1 if through == "end" else last.get(through, first[key])
        if through not in ("end", key) and through not in last:
            warn(f"narration passage {key!r}: 'through' names {through!r}, which no shot has; it spans its own shot")
        lines.append({"key": key, "text": text, "shot": first[key], "end": max(end, first[key])})
    lines.sort(key=lambda ln: ln["shot"])
    if not lines:
        return []
    for ln, wav in zip(lines, synth([ln["text"] for ln in lines], voice, speed, out_dir)):
        ln["wav"] = str(wav)
        ln["dur"] = round(len(decode(wav)) / SR, 3)
    for i, ln in enumerate(lines):
        beat = sum(s.dur for s in shots[:ln["shot"]])
        at = max(beat + 0.25, lead_in) if i == 0 else beat + 0.25
        span = shots[ln["shot"]:ln["end"] + 1]
        short = (at - beat) + ln["dur"] + GAP - sum(s.dur for s in span)
        if short > 0:
            for s in span:
                s.dur += short / len(span)
    starts = [0.0]
    for s in shots:
        starts.append(starts[-1] + s.dur)
    for i, ln in enumerate(lines):
        ln["beat"] = round(starts[ln["shot"]], 3)
        ln["at"] = round(max(ln["beat"] + 0.25, lead_in) if i == 0 else ln["beat"] + 0.25, 3)
    for a, b in zip(lines, lines[1:]):
        if a["at"] + a["dur"] > b["at"]:
            warn(f"passages {a['key']!r} and {b['key']!r} overlap: end the first one's 'through' before the second starts")
    (out_dir / "lines.json").write_text(json.dumps(lines, indent=1, ensure_ascii=False))
    return lines


# ------------------------------------------------------------------ the soundtrack
def soundtrack(total: float, out_dir: Path, music: Path | None, start: float, lines: list[dict[str, Any]],
               voice_lufs: float = -16.0, music_lufs: float = -23.0) -> None:
    """narration.wav (the lines at their times, one static gain to voice_lufs), music.wav (the
    track from `start`, at one steady music_lufs, fading in briefly and out at the end) and
    mix.wav (their sum), all `total` seconds long, in out_dir."""
    n = int(round(total * SR))
    stems: dict[str, np.ndarray] = {}
    if lines:
        voice = np.zeros((n, 2), dtype=np.float32)
        for ln in lines:
            pcm = decode(ln["wav"])
            i = int(ln["at"] * SR)
            pcm = pcm[: max(0, n - i)]
            voice[i:i + len(pcm)] += pcm
        stems["narration"] = _gain(voice, voice_lufs, out_dir / "narration-raw.wav")
    if music is not None:
        bed = decode(music.expanduser(), start, total)
        if len(bed) < n:
            warn(f"the music runs out {(n - len(bed)) / SR:.1f} s before the video ends: pick an earlier --music-start")
            bed = np.concatenate([bed, np.zeros((n - len(bed), 2), dtype=np.float32)])
        bed = _gain(bed[:n], music_lufs, out_dir / "music-raw.wav")
        env = np.ones(n, dtype=np.float32)
        fi, fo = min(int(MUSIC_FADE_IN * SR), n), min(int(MUSIC_FADE_OUT * SR), n)
        env[:fi] *= np.linspace(0.0, 1.0, fi, dtype=np.float32)
        env[n - fo:] *= np.linspace(1.0, 0.0, fo, dtype=np.float32)
        stems["music"] = bed * env[:, None]
    if not stems:
        return
    mix = sum(stems.values())
    peak = float(np.abs(mix).max())
    if peak > 0.95:  # one static trim for the whole mix: the voice-to-music gap stays the same
        k = 0.95 / peak
        mix = mix * k
        stems = {name: pcm * k for name, pcm in stems.items()}
    for name in ("narration", "music"):
        (out_dir / f"{name}.wav").unlink(missing_ok=True)
    for name, pcm in stems.items():
        write_wav(out_dir / f"{name}.wav", pcm)
    write_wav(out_dir / "mix.wav", mix)


def report(out_dir: Path) -> str:
    """The stems' loudness and the gap between voice and music (aim for about 7 dB)."""
    got = {name: lufs(out_dir / f"{name}.wav") for name in ("narration", "music", "mix")
           if (out_dir / f"{name}.wav").exists()}
    rows = [f"  {name:9s} {v:6.1f} LUFS" if v is not None else f"  {name:9s}   silent" for name, v in got.items()]
    v, m = got.get("narration"), got.get("music")
    if v is not None and m is not None:
        gap = v - m
        verdict = "good" if 5 <= gap <= 9 else ("music too loud" if gap < 5 else "music too quiet")
        rows.append(f"  voice is {gap:.1f} dB over the music ({verdict}; aim for about 7)")
    return "soundtrack:\n" + "\n".join(rows)


def pauses(track: Path, until: float = 20.0, window: float = 0.1, top: int = 5) -> list[tuple[float, float]]:
    """The deepest quiet moments in the first `until` seconds of a track, deepest first, as
    (time, dB below the track's median): candidates for the end of the lead-in, where the first
    spoken line starts. Listen to the top one or two before choosing."""
    pcm = decode(track, 0.0, until).mean(axis=1)
    hop = int(window * SR)
    frames = len(pcm) // hop
    rms = np.sqrt(np.mean(pcm[: frames * hop].reshape(frames, hop) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms)
    med = float(np.median(db))
    dips = [(round(i * window, 2), round(med - float(db[i]), 1)) for i in range(1, frames - 1)
            if db[i] <= db[i - 1] and db[i] <= db[i + 1] and med - db[i] >= 6]
    found: list[tuple[float, float]] = []
    for t, depth in sorted(dips, key=lambda d: -d[1]):
        if all(abs(t - f[0]) > 0.5 for f in found):
            found.append((t, depth))
    return found[:top]
