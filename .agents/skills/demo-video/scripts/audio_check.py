# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
"""Check a soundtrack before sending it for approval, or find where a music track pauses.

    uv run audio_check.py levels <take>/out      # loudness of narration, music, mix, and the gap
    uv run audio_check.py pauses track.mp3       # quiet moments in its first 20 s, for --lead-in
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from demo_video import sound  # noqa: E402

ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
sub = ap.add_subparsers(dest="cmd", required=True)
lv = sub.add_parser("levels", help="the stems' loudness and the voice-to-music gap")
lv.add_argument("dir", type=Path, help="the folder with narration.wav / music.wav / mix.wav (a take's out/)")
pa = sub.add_parser("pauses", help="quiet moments near the start of a track")
pa.add_argument("track", type=Path)
pa.add_argument("--until", type=float, default=20.0, help="how far into the track to look (s)")
args = ap.parse_args()
if args.cmd == "levels":
    print(sound.report(args.dir))
else:
    found = sound.pauses(args.track, args.until)
    if not found:
        print("no clear pauses; pick a --lead-in by ear (4 s is a fair default)")
    for t, depth in found:
        print(f"{t:6.2f} s  {depth:4.1f} dB below the track's median")
