# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
"""An original 8-bit music bed in a style you pick, timed to the cut: no licence to check, no credit line.

    uv run chiptune.py --list                                              # the built-in styles
    uv run chiptune.py --style jazz --shots <take>/out/shots.json --seed 3 --out <take>/out/music.wav
    uv run chiptune.py --style rock --seconds 40 --bpm 132 --key E --out bed.wav
    uv run chiptune.py --style-file mine.json --seconds 40 --out bed.wav   # a style of your own

Every style plays on the same 8-bit instruments (pulse, triangle, sine and noise voices). A style is the
groove: tempo, swing, chord progressions in Roman numerals, a bass line, comping, drum patterns, the
lead's rhythms and scale, a cadence and a mix. A style file is JSON with any of those keys, plus "base"
to start from a built-in style (`--list` shows them; `--show jazz` prints one to copy).

Each card is a one-bar stop: drums and lead drop out, the tonic chord hits on the card's first frame, and
the groove comes back on the next downbeat with the progression starting over. The ending is the style's
cadence, landing on the end card and ringing out. `--shots` reads the timings `edit.py --stills` writes,
so the stops land on the cards; with narration, shots stretch after --stills, so leave the stops out and
use `--seconds`. Each --seed is a different tune: pick a new one per video.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
import wave
from pathlib import Path
from typing import Any

import numpy as np

SR = 44100
STEPS = 16  # sixteenth notes per bar; every pattern below is written on this grid

# Patterns: one character per step. Drums: "x" hit, "X" accent, "g" ghost, "." rest. Lead rhythms:
# "x" a note starts, "-" it holds, "." rest, over two bars (32 steps; 16 characters means eighths).
STYLES: dict[str, dict[str, Any]] = {
    "chiptune": {
        "about": "swung dorian groove: walking bass, arpeggios, a pulse riff with an answer",
        "bpm": [88, 108], "swing": [0.56, 0.6], "keys": ["C", "D", "E", "F", "G", "A"],
        "scale": "dorian",
        "progressions": [["i7", "IV7"], ["i7", "IV7", "i7", "bVII"], ["i7", "ii7", "bIII", "IV"]],
        "bass": "walking", "comp": "arp",
        "drums": [{"kick": "x.......x.......", "snare": "....x.......x...", "hat": "..x...x...x...x.",
                   "ohat": "..............x."},
                  {"kick": "x.....x.x.......", "snare": "....x.......x...", "hat": "..x...x...x...x."}],
        "fill": "............x.xx",
        "lead": ["x.xx.xx.xx.xx.xx", "x-xx.x.xx-x-.x..", ".xx.xx.xx.x-x-.."],
        "lead_range": [62, 81], "lead_bars": "all",
        "cadence": ["IV"], "tonic": "i7", "final": "I",
        "sound": {"bass": "triangle", "comp": ["pulse", 0.125], "lead": ["pulse", 0.25]},
        "mix": {"bass": 0.22, "comp": 0.05, "lead": 0.15},
    },
    "jazz": {
        "about": "medium swing: walking bass, Charleston comping on shells, ride cymbal, a bebop-ish head",
        "bpm": [116, 152], "swing": [0.64, 0.67], "keys": ["C", "F", "Bb", "Eb", "G"],
        "scale": "major",
        "progressions": [["ii7", "V7", "Imaj7", "VI7"], ["Imaj7", "vi7", "ii7", "V7"],
                         ["iii7", "VI7", "ii7", "V7"]],
        "bass": "walking", "comp": "charleston",
        "drums": [{"ride": "x...x.x.x...x.x.", "hat": "....x.......x...", "kick": "g...g...g...g..."},
                  {"ride": "x...x.x.x...x.x.", "hat": "....x.......x...", "snare": "......g.......g."}],
        "fill": "..........g..x.x", "crash": True,
        "lead": ["..xxxx.xx-..xx-.", "x.x.xxx-..xxxx-.", ".xxx.x-.x.xx--.."],
        "lead_range": [60, 79], "lead_bars": "alternate",
        "cadence": ["ii7", "V7"], "final": "Imaj7",
        "sound": {"bass": "triangle", "comp": ["pulse", 0.5], "lead": ["pulse", 0.25]},
        "mix": {"bass": 0.26, "comp": 0.07, "lead": 0.13, "ride": 0.05, "hat": 0.05, "kick": 0.25},
    },
    "hiphop": {
        "about": "boom bap: swung sixteenths, sub bass on the kick, minor-seventh stabs, a lazy lead",
        "bpm": [84, 96], "swing": [0.5], "swing16": [0.56, 0.6], "keys": ["A", "C", "D", "E", "F"],
        "scale": "minor_pentatonic",
        "progressions": [["i7", "bVImaj7", "iv7", "v7"], ["i7", "iv7"], ["i7", "bVII", "bVImaj7", "v7"]],
        "bass": "sub", "comp": "stabs",
        "drums": [{"kick": "x......x..x.....", "snare": "....X.......X..g", "hat": "x.x.x.x.x.x.x.x."},
                  {"kick": "x.........x..x..", "snare": "....X.......X...", "hat": "x.xxx.x.x.xxx.x."}],
        "fill": "", "crash": False,
        "lead": ["x--.....x-.x....x--.....x-x-....", "....x-x-...x--..x-.....x-x.x-...",
                 "x-..x-..x.x.x-..x---......x-x-.."],
        "lead_range": [64, 81], "lead_bars": "alternate",
        "cadence": ["iv7"], "final": "i7",
        "sound": {"bass": "sine", "comp": ["pulse", 0.5], "lead": ["triangle"]},
        "mix": {"bass": 0.4, "comp": 0.07, "lead": 0.16, "kick": 0.85, "snare": 0.4, "hat": 0.06},
    },
    "rock": {
        "about": "straight eighths: driving root bass, power chords, backbeat with crashes, a pentatonic riff",
        "bpm": [112, 144], "swing": [0.5], "keys": ["E", "A", "D", "G"],
        "scale": "minor_pentatonic",
        "progressions": [["I5", "V5", "vi5", "IV5"], ["I5", "IV5", "V5", "IV5"], ["I5", "bVII5", "IV5", "I5"]],
        "bass": "root8", "comp": "power",
        "drums": [{"kick": "x.......x.x.....", "snare": "....X.......X...", "hat": "x.x.x.x.x.x.x.x."},
                  {"kick": "x.x.....x.x.....", "snare": "....X.......X...", "hat": "x.x.x.x.x.x.x.x."}],
        "fill": "............xxxx", "crash": True,
        "lead": ["x-x.x-x.x-x.xxx.", "x..x..x.x..x..x.", "xx.x.xx.x---x.x."],
        "lead_range": [64, 83], "lead_bars": "all",
        "cadence": ["IV5", "V5"], "final": "I5",
        "sound": {"bass": "pulse", "comp": ["saw"], "lead": ["pulse", 0.5]},
        "mix": {"bass": 0.18, "comp": 0.07, "lead": 0.12, "kick": 0.8, "snare": 0.4},
    },
    "bossa": {
        "about": "bossa nova: straight eighths, root-fifth bass, syncopated chords, rim clave, shaker",
        "bpm": [120, 140], "swing": [0.5], "keys": ["F", "G", "D", "C"],
        "scale": "major",
        "progressions": [["Imaj7", "II7", "ii7", "V7"], ["Imaj7", "vi7", "ii7", "V7"], ["ii7", "V7", "Imaj7", "Imaj7"]],
        "bass": "bossa", "comp": "bossa",
        "drums": [{"kick": "x......xx......x", "rim": "x..x..x...x..x..", "shaker": "xxxxxxxxxxxxxxxx"}],
        "fill": "", "crash": False,
        "lead": ["x---x-x-x-------", ".x-x-x-x-------.", "x-x-x---.x-x-x--"],
        "lead_range": [62, 81], "lead_bars": "all",
        "cadence": ["ii7", "V7"], "final": "Imaj7",
        "sound": {"bass": "triangle", "comp": ["pulse", 0.25], "lead": ["triangle"]},
        "mix": {"bass": 0.26, "comp": 0.06, "lead": 0.17, "kick": 0.35, "rim": 0.1, "shaker": 0.025},
    },
}

DEFAULT_MIX = {"bass": 0.22, "comp": 0.06, "lead": 0.14, "stab": 0.16, "kick": 0.7, "snare": 0.3, "hat": 0.08,
               "ohat": 0.08, "ride": 0.06, "rim": 0.12, "shaker": 0.03, "crash": 0.1}
SCALES = {"major": [0, 2, 4, 5, 7, 9, 11], "dorian": [0, 2, 3, 5, 7, 9, 10], "minor": [0, 2, 3, 5, 7, 8, 10],
          "mixolydian": [0, 2, 4, 5, 7, 9, 10], "minor_pentatonic": [0, 3, 5, 7, 10],
          "major_pentatonic": [0, 2, 4, 7, 9], "blues": [0, 3, 5, 6, 7, 10]}
PITCH = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7,
         "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}
NUMERAL = {"i": 0, "ii": 2, "iii": 4, "iv": 5, "v": 7, "vi": 9, "vii": 11}
CHORD_RX = re.compile(r"^(b|#)?(vii|vi|v|iv|iii|ii|i)(maj7|m7b5|dim|sus|7|6|9|5)?$", re.I)


def chord(symbol: str) -> tuple[int, list[int]]:
    """A Roman numeral to (root semitones above the key, intervals above the root). Upper case is a
    major third, lower case minor; 7 is dominant on upper case and minor on lower case; maj7, 6, 9,
    5 (a power chord), dim, m7b5 and sus mean what they say. bVI is the flat sixth degree."""
    m = CHORD_RX.match(symbol)
    if not m:
        sys.exit(f"chiptune: can't read the chord {symbol!r} (try I, ii7, V7, bVImaj7, IV5)")
    acc, numeral, kind = m.group(1) or "", m.group(2), (m.group(3) or "").lower()
    root = NUMERAL[numeral.lower()] + (-1 if acc == "b" else 1 if acc == "#" else 0)
    third = 4 if numeral.isupper() else 3
    shapes = {"": [0, third, 7], "7": [0, third, 7, 10], "maj7": [0, third, 7, 11], "6": [0, third, 7, 9],
              "9": [0, third, 7, 10, 14], "5": [0, 7, 12], "dim": [0, 3, 6], "m7b5": [0, 3, 6, 10],
              "sus": [0, 5, 7]}
    return root % 12, shapes[kind]


def hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def near(pc: int, lo: int, hi: int) -> int:
    """The MIDI note of pitch class `pc` in [lo, hi), lowest first."""
    n = lo + (pc - lo) % 12
    return n if n < hi else n - 12


class Track:
    """The stereo mix, and the instruments that play into it."""

    def __init__(self, seconds: float, seed: int, mix: dict[str, float]) -> None:
        self.n = int(round(seconds * SR))
        self.mix = np.zeros((self.n, 2), dtype=np.float32)
        self.rng = np.random.default_rng(seed)
        self.vol = mix

    def add(self, sig: np.ndarray, at: float, pan: float, vol: float) -> None:
        i = int(at * SR)
        if i < 0 or i >= self.n or vol <= 0:
            return
        sig = sig[: self.n - i] * vol
        self.mix[i:i + len(sig), 0] += sig * (0.5 + (1 - pan) / 2)
        self.mix[i:i + len(sig), 1] += sig * (0.5 + (1 + pan) / 2)

    def note(self, midi: float, seconds: float, at: float, part: str, sound: list[Any], pan: float = 0.0,
             gain: float = 1.0, attack: float = 0.005, decay: float = 0.08, sustain: float = 0.55) -> None:
        n = int(seconds * SR)
        if n <= 0:
            return
        ph = (np.arange(n) * hz(midi) / SR) % 1.0
        kind = sound[0]
        if kind == "pulse":
            w = np.where(ph < (sound[1] if len(sound) > 1 else 0.5), 1.0, -1.0)
        elif kind == "triangle":
            w = 4 * np.abs(ph - 0.5) - 1
        elif kind == "saw":
            w = 2 * ph - 1
        else:  # sine
            w = np.sin(2 * np.pi * ph)
        self.add(w.astype(np.float32) * envelope(n, attack, decay, sustain), at, pan, self.vol[part] * gain)

    def drum(self, voice: str, at: float, gain: float = 1.0) -> None:
        vol = self.vol.get(voice, 0.0) * gain
        if voice == "kick":
            t = np.arange(int(0.18 * SR)) / SR
            f = 110 * np.exp(-t * 20) + 45
            sig = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 13)
        elif voice == "snare":
            t = np.arange(int(0.13 * SR)) / SR
            sig = self.noise(len(t)) * np.exp(-t * 26) + 0.4 * np.sin(2 * np.pi * 190 * t) * np.exp(-t * 40)
        elif voice in ("hat", "ohat", "shaker"):
            length, rate = {"hat": (0.04, 60), "ohat": (0.2, 9), "shaker": (0.05, 45)}[voice]
            t = np.arange(int(length * SR)) / SR
            sig = np.diff(self.noise(len(t) + 1)) * 0.5 * np.exp(-t * rate)
        elif voice == "ride":
            t = np.arange(int(0.6 * SR)) / SR
            ring = sum(np.where((t * f) % 1.0 < 0.5, 1.0, -1.0) for f in (3120.0, 4970.0, 6350.0)) / 3
            sig = (0.6 * np.diff(self.noise(len(t) + 1)) + 0.4 * ring) * np.exp(-t * 7)
        elif voice == "rim":
            t = np.arange(int(0.03 * SR)) / SR
            sig = (np.sin(2 * np.pi * 1700 * t) + 0.3 * self.noise(len(t))) * np.exp(-t * 160)
        elif voice == "crash":
            t = np.arange(int(1.4 * SR)) / SR
            sig = np.diff(self.noise(len(t) + 1)) * np.exp(-t * 2.6)
        else:
            return
        pan = {"hat": -0.3, "ohat": -0.3, "ride": 0.35, "rim": 0.2, "shaker": -0.4, "crash": 0.25}.get(voice, 0.0)
        self.add(sig.astype(np.float32), at, pan, vol)

    def noise(self, n: int) -> np.ndarray:
        return self.rng.uniform(-1, 1, n)


def envelope(n: int, attack: float, decay: float, sustain: float, release: float = 0.03) -> np.ndarray:
    t = np.arange(n) / SR
    e = np.full(n, sustain, dtype=np.float32)
    att = t < attack
    e[att] = t[att] / attack
    dec = (t >= attack) & (t < attack + decay)
    e[dec] = 1 - (1 - sustain) * (t[dec] - attack) / decay
    rel = int(release * SR)
    if 0 < rel < n:
        e[-rel:] *= np.linspace(1, 0, rel)
    return e


def load_style(name: str | None, path: Path | None) -> dict[str, Any]:
    if path:
        own = json.loads(path.read_text())
        base = own.pop("base", name or "chiptune")
    else:
        own, base = {}, name or "chiptune"
    if base not in STYLES:
        sys.exit(f"chiptune: no style {base!r}; the styles are {', '.join(STYLES)}")
    style = copy.deepcopy(STYLES[base])
    style.update(own)
    style["mix"] = {**DEFAULT_MIX, **STYLES[base].get("mix", {}), **own.get("mix", {})}
    return style


def from_shots(path: Path) -> tuple[float, list[float], float]:
    """Length, the cards to stop on, and where the ending lands (the end card, if the cut ends on one)."""
    shots = json.loads(path.read_text())
    seconds = sum(s["dur"] for s in shots)
    cards = [s["start"] for s in shots if s.get("card")]
    if shots and shots[-1].get("card"):
        return seconds, cards[:-1], shots[-1]["start"]
    return seconds, cards, max(0.0, seconds - 2.5)


def lead_cells(style: dict[str, Any], pick: np.random.Generator) -> list[list[tuple[int, int, int]]]:
    """Four two-bar cells for the lead, in an A A' B A'' shape: (step, length in steps, scale-step move)
    per note. The moves are mostly steps, with the odd leap; chord tones get snapped to later."""
    def rhythm(t: str) -> list[tuple[int, int]]:
        k = 32 // len(t)  # 2 for a pattern written in eighths
        notes, i = [], 0
        while i < len(t):
            if t[i] == "x":
                j = i + 1
                while j < len(t) and t[j] == "-":
                    j += 1
                notes.append((i * k, (j - i) * k))
                i = j
            else:
                i += 1
        return notes

    def moves(count: int) -> list[int]:
        return [int(pick.choice([-2, -1, 1, 2, -3, 3, 0], p=[.12, .22, .22, .12, .07, .07, .18]))
                for _ in range(count)]

    a_rhythm = rhythm(str(pick.choice(style["lead"])))
    b_rhythm = rhythm(str(pick.choice(style["lead"])))
    a = [(s, ln, mv) for (s, ln), mv in zip(a_rhythm, moves(len(a_rhythm)))]
    b = [(s, ln, mv) for (s, ln), mv in zip(b_rhythm, moves(len(b_rhythm)))]
    return [a, a, b, a]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--list", action="store_true", help="the built-in styles, and stop")
    ap.add_argument("--show", metavar="STYLE", help="print a style as JSON (a starting point for --style-file)")
    ap.add_argument("--style", default="chiptune", help=f"one of: {', '.join(STYLES)}")
    ap.add_argument("--style-file", type=Path, help="a JSON style: any style's keys, plus \"base\"")
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--shots", type=Path, help="out/shots.json from edit.py --stills: stops on the cards")
    src.add_argument("--seconds", type=float, help="the length, for a bed without card stops")
    ap.add_argument("--stops", default="", help="with --seconds: comma-separated times (s) to stop on")
    ap.add_argument("--ending", type=float, help="where the final chord lands (default: the end card, or 2.5 s from the end)")
    ap.add_argument("--bpm", type=float, help="the tempo (default: the seed picks one in the style's range)")
    ap.add_argument("--key", help="the key, a note name like E or Bb (default: the seed picks)")
    ap.add_argument("--swing", type=float, help="where the off-beat eighth sits in the beat: 0.5 straight, 0.67 triplet")
    ap.add_argument("--seed", type=int, default=1, help="the tune: a new one per video")
    ap.add_argument("--out", type=Path, help="the WAV to write (then pass it to edit.py as --music)")
    a = ap.parse_args()

    if a.list:
        for name, s in STYLES.items():
            print(f"{name:9s} {s['bpm'][0]}-{s['bpm'][1]} bpm  {s['about']}")
        return
    if a.show:
        print(json.dumps({"base": a.show, **load_style(a.show, None)}, indent=1))
        return
    if not a.out or not (a.shots or a.seconds):
        ap.error("--out and one of --shots or --seconds are required")

    style = load_style(a.style, a.style_file)
    if a.shots:
        seconds, stops, ending = from_shots(a.shots)
    else:
        seconds = a.seconds
        stops = [float(x) for x in a.stops.split(",") if x.strip()]
        ending = seconds - 2.5
    if a.ending is not None:
        ending = a.ending
    if seconds <= 2.0:
        sys.exit("chiptune: the track needs to be longer than two seconds")
    ending = min(max(ending, 0.0), seconds)

    pick = np.random.default_rng(a.seed)   # every choice is drawn, so an override changes only itself
    lo, hi = style["bpm"]
    bpm = float(pick.choice(np.arange(lo, hi + 1, 4)))
    bpm = a.bpm or bpm
    key_name = str(pick.choice(style["keys"]))
    key_name = a.key or key_name
    if key_name not in PITCH:
        sys.exit(f"chiptune: no key {key_name!r}; use a note name like C, F#, Bb")
    key = PITCH[key_name]
    swing = float(pick.choice(style.get("swing", [0.5])))
    swing = a.swing or swing
    swing16 = float(pick.choice(style.get("swing16", [0.5])))
    progression = [chord(c) for c in style["progressions"][int(pick.integers(len(style["progressions"])))]]
    drums_main = style["drums"][int(pick.integers(len(style["drums"])))]
    cells = lead_cells(style, pick)
    scale = sorted({(key + i) % 12 for i in SCALES[style["scale"]]})
    sound, vol = style["sound"], style["mix"]

    beat = 60.0 / bpm
    bar = STEPS / 4 * beat
    within = [0.0, swing16 * swing, swing, swing + swing16 * (1 - swing)]   # where each sixteenth sits in a beat

    def at(bar_t: float, step: int) -> float:
        return bar_t + (step // 4 + within[step % 4]) * beat

    tr = Track(seconds, a.seed, vol)
    cadence = [chord(c) for c in style["cadence"]]
    groove_end = ending - len(cadence) * beat
    stops = [s for s in sorted(set(stops)) if 0.0 <= s <= groove_end - bar]
    stops = [s for i, s in enumerate(stops) if i == 0 or s - stops[i - 1] >= bar]   # a bar apart at least

    def voicing(root: int, ivs: list[int], lo_: int = 55) -> list[int]:
        """A close voicing above `lo_`; shells (third and seventh) when the chord has a seventh."""
        if style["comp"] == "charleston" and len(ivs) >= 4:
            ivs = [ivs[1], ivs[3]] + ivs[4:]
        return sorted({near((key + root + iv) % 12, lo_, lo_ + 12) for iv in ivs})

    def bass_note(pc: int) -> int:
        return near(pc, 36, 48)

    def play_bass(bar_t: float, cur: tuple[int, list[int]], nxt: tuple[int, list[int]], limit: float) -> None:
        root = bass_note(key + cur[0])
        fifth = root + 7 if 7 in cur[1] else root + cur[1][-1]
        kind = style["bass"]
        tone = [sound["bass"]] if isinstance(sound["bass"], str) else sound["bass"]
        if kind == "walking":
            nxt_root = bass_note(key + nxt[0])
            approach = nxt_root + (1 if pick.random() < 0.5 else -1)
            line = [root, root + cur[1][1] if pick.random() < 0.6 else fifth, fifth, approach]
            notes = [(4 * i, 4, n) for i, n in enumerate(line)]
        elif kind == "root8":
            notes = [(2 * i, 2, root + (12 if i == 7 else 0)) for i in range(8)]
        elif kind == "sub":
            hits = [i for i, c in enumerate(drums_main.get("kick", "x...")) if c in "xX"] or [0]
            notes = [(s, (hits[j + 1] if j + 1 < len(hits) else STEPS) - s, root - 12 if root >= 43 else root)
                     for j, s in enumerate(hits)]
        elif kind == "bossa":
            low_fifth = fifth - 12 if fifth - 12 >= 33 else fifth
            notes = [(0, 6, root), (6, 2, low_fifth), (8, 6, low_fifth), (14, 2, bass_note(key + nxt[0]))]
        else:  # pedal
            notes = [(0, 8, root), (8, 8, root)]
        for s, ln, m in notes:
            t0 = at(bar_t, s)
            if t0 < limit:
                tr.note(m, min(ln * beat / 4 * 0.92, limit - t0), t0, "bass", tone, decay=0.1, sustain=0.7)

    def play_comp(bar_t: float, cur: tuple[int, list[int]], limit: float, bar_i: int) -> None:
        kind = style["comp"]
        notes = voicing(*cur)
        hits: list[tuple[int, int, list[int]]]
        if kind == "charleston":
            hits = [(0, 2, notes), (6, 2, notes)] if bar_i % 2 == 0 else [(2, 2, notes), (10, 2, notes)]
        elif kind == "stabs":
            hits = [(0, 3, notes), (10, 3, notes)]
        elif kind == "power":
            root = near((key + cur[0]) % 12, 40, 52)
            hits = [(2 * i, 2, [root, root + 7, root + 12]) for i in range(8)]
        elif kind == "bossa":
            hits = [(s, 2, notes) for s in (0, 3, 6, 10, 12)]
        elif kind == "arp":
            up = notes + [n + 12 for n in notes]
            hits = [(s, 1, [up[s % len(up)]]) for s in range(STEPS)]
        elif kind == "pad":
            hits = [(0, STEPS, notes)]
        else:
            return
        for s, ln, chord_notes in hits:
            t0 = at(bar_t, s)
            if t0 >= limit:
                continue
            accent = 1.0 if s in (0, 8) else 0.8
            for i, m in enumerate(chord_notes):
                tr.note(m, min(ln * beat / 4 * 0.85, limit - t0), t0, "comp", sound["comp"], pan=(i - 1) * 0.15,
                        gain=accent, decay=0.05, sustain=0.4)

    def play_lead(bar_t: float, cell_bar: int, cell: list[tuple[int, int, int]], chords_at: list[tuple[int, list[int]]],
                  limit: float, state: dict[str, int]) -> None:
        lo_, hi_ = style["lead_range"]
        pool = [n for n in range(lo_, hi_ + 1) if n % 12 in scale]
        for s, ln, mv in cell:
            if s // STEPS != cell_bar:
                continue
            t0 = at(bar_t, s % STEPS)
            if t0 >= limit:
                continue
            cur = chords_at[cell_bar]
            tones = {(key + cur[0] + iv) % 12 for iv in cur[1]}
            idx = state.get("idx", len(pool) // 2)
            idx = min(max(idx + mv, 0), len(pool) - 1)
            if s % 8 == 0:   # strong beats land on a chord tone
                best = min(range(len(pool)), key=lambda j: (pool[j] % 12 not in tones, abs(j - idx)))
                idx = best if pool[best] % 12 in tones else idx
            state["idx"] = idx
            m = pool[idx]
            if pool[idx] % 12 not in tones and (s % 4 == 0):   # chromatic chord tones the scale lacks
                m = min((n for n in range(m - 2, m + 3) if n % 12 in tones), key=lambda n: abs(n - m), default=m)
            tr.note(m, min(ln * beat / 4 * 0.9, limit - t0), t0, "lead", sound["lead"], pan=-0.1)

    def play_drums(bar_t: float, pattern: dict[str, str], limit: float) -> None:
        for voice, pat in pattern.items():
            for s, c in enumerate(pat[:STEPS]):
                if c in "xXg":
                    t0 = at(bar_t, s)
                    if t0 < limit:
                        tr.drum(voice, t0, {"X": 1.25, "g": 0.35}.get(c, 1.0))

    # The groove, in sections that start on a downbeat: at 0 and at every card. Each starts its progression over.
    starts = sorted({0.0, *stops})
    lead_state: dict[str, int] = {}
    for k, s0 in enumerate(starts):
        s1 = min(starts[k + 1] if k + 1 < len(starts) else groove_end, groove_end)
        t, bar_i = s0, 0
        if s0 in stops:   # the stop: the tonic chord on the card, bass and a cymbal, then the groove returns
            tonic = chord(style.get("tonic", style["final"]))
            for i, m in enumerate(voicing(*tonic, lo_=55)):
                tr.note(m, min(bar * 0.6, s1 - s0), s0 + 0.03 * i, "stab", sound["comp"], pan=(i - 1) * 0.3,
                        attack=0.003, decay=0.25, sustain=0.35)
            tr.note(bass_note(key + tonic[0]), min(bar * 0.9, s1 - s0), s0, "bass",
                    [sound["bass"]] if isinstance(sound["bass"], str) else sound["bass"], decay=0.3, sustain=0.5)
            tr.drum("crash" if style.get("crash") else "ohat", s0)
            t, bar_i = s0 + bar, 0
        while t < s1 - 1e-6:
            cur = progression[bar_i % len(progression)]
            nxt = progression[(bar_i + 1) % len(progression)]
            pattern = dict(drums_main)
            if style.get("fill") and t + 2 * bar > s1:   # the last bar before a card or the cadence
                pattern["snare"] = style["fill"]
            if bar_i == 0 and t > 0 and style.get("crash"):   # the groove coming back after a card
                tr.drum("crash", t, 0.7)
            play_drums(t, pattern, s1)
            play_bass(t, cur, nxt, s1)
            play_comp(t, cur, s1, bar_i)
            if style["lead_bars"] == "all" or (bar_i // 4) % 2 == 0:   # "alternate": four bars on, four off
                cell_i = (lead_state.get("bars", 0) // 2) % 4
                pair = [progression[(bar_i - bar_i % 2 + j) % len(progression)] for j in range(2)]
                play_lead(t, bar_i % 2, cells[cell_i], pair, s1, lead_state)
                lead_state["bars"] = lead_state.get("bars", 0) + 1
            t += bar
            bar_i += 1

    # The cadence, a beat a chord, then the final chord rings out over the last of the drums.
    for i, c in enumerate(cadence):
        t0 = groove_end + i * beat
        for j, m in enumerate(voicing(*c)):
            tr.note(m, beat * 0.95, t0, "comp", sound["comp"], pan=(j - 1) * 0.2, decay=0.1, sustain=0.6)
        tr.note(bass_note(key + c[0]), beat * 0.95, t0, "bass", [sound["bass"]] if isinstance(sound["bass"], str) else sound["bass"])
        tr.drum("kick", t0, 0.6)
    final = chord(style["final"])
    ring = seconds - ending
    if ring > 0.05:
        n = int(ring * SR)
        fade = np.exp(-np.arange(n) / SR / max(ring * 0.55, 0.1)).astype(np.float32)
        tones = [bass_note(key + final[0])] + voicing(*final, lo_=52) + [voicing(*final, lo_=64)[-1]]
        for i, m in enumerate(tones):
            kind = sound["bass"] if i == 0 else sound["comp"]
            kind = [kind] if isinstance(kind, str) else kind
            ph = (np.arange(n) * hz(m) / SR) % 1.0
            if kind[0] == "pulse":
                w = np.where(ph < (kind[1] if len(kind) > 1 else 0.5), 1.0, -1.0)
            elif kind[0] == "saw":
                w = 2 * ph - 1
            elif kind[0] == "sine":
                w = np.sin(2 * np.pi * ph)
            else:
                w = 4 * np.abs(ph - 0.5) - 1
            part = "bass" if i == 0 else "comp"
            tr.add(w.astype(np.float32) * fade, ending, (i - 2) * 0.15, vol[part] * (1.0 if i == 0 else 1.4))
        tr.drum("kick", ending)
        tr.drum("crash" if style.get("crash") else "ohat", ending)
        tt, gap = ending + beat, beat * 0.5
        cym = "ride" if "ride" in drums_main else "hat"
        while tt < seconds - 0.2:
            tr.drum(cym, tt, 0.7)
            tt += gap
            gap *= 1.3

    peak = float(np.max(np.abs(tr.mix))) or 1.0
    pcm = (np.clip(tr.mix / peak * 0.5, -1, 1) * 32767).astype("<i2")   # edit.py sets the bed's level
    a.out.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(a.out), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    name = a.style_file.name if a.style_file else a.style
    feel = f"swing {swing:.2f}" + (f", sixteenths {swing16:.2f}" if swing16 != 0.5 else "")
    print(f"wrote {a.out}: {seconds:.1f} s of {name} in {key_name} at {bpm:.0f} bpm, {feel}, "
          f"{len(stops)} card stops, ending at {ending:.1f} s (seed {a.seed})")


if __name__ == "__main__":
    main()
