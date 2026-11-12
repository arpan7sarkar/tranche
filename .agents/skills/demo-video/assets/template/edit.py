# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow", "numpy"]
# ///
"""Cut the __NAME__ demo from a take.

    uv run edit.py --build <take> --stills                    # one frame per shot: check framing and captions
    uv run edit.py --build <take> --audio-only --voice bm_george --music <track>   # the sound alone, for approval
    uv run edit.py --build <take> --voice bm_george --music <track> --audio-approved --gif   # the video and GIF

Captions and narration live in the take's captions.json: the first run copies captions.json from
beside this file into the take. Write them after watching the take, not before.
"""

import sys

sys.path.insert(0, "__SCRIPTS__")  # the kit's scripts folder (new_project.py filled this in)

from demo_video import cut  # noqa: E402
from demo_video.cut import Shot, Take  # noqa: E402

TITLE = "__NAME__"
TAGLINE = "One line about what it does."
INSTALL = ["your install command"]  # the end card's shell lines
URL = "your.site/or-repo"           # the end card's link (read off the screen, never aloud)


def shots(take: Take) -> list[Shot]:
    """The MP4: splash over the music's lead-in, a cold open on the finished state, the beats as
    they happened (typing at its real pace, cut short), the finished state again, the end card."""
    typing, added, ticked, end = (take.mark(m) for m in ("typing", "added", "ticked", "end"))
    whole = take.around("app", end["box"], pad=48)                         # the app's card, not the empty window
    form = take.around("app", typing["box"], pad=40, min_w=700)            # close on the input while typing
    work = take.around("app", cut.union(typing["box"], added["box"]), pad=40)  # the form and the list it fills
    return [
        cut.title_card(TITLE, TAGLINE),
        take.still("app", end["t"], 3.2, whole, key="open"),
        take.clip("app", typing["t"] - 0.4, typing["t"] + 3.0, crop=form, key="type", top=True),
        take.clip("app", added["t"] - 0.5, added["t"] + 1.8, crop=work, to=cut.zoom_in(work, 1.03), key="added"),
        take.clip("app", ticked["t"] - 0.4, ticked["t"] + 2.0, crop=work, key="ticked"),
        take.still("app", end["t"], 3.0, whole, to=cut.zoom_in(whole, 1.03), key="final"),
        cut.end_card(TITLE, TAGLINE, lines=INSTALL, url=URL, credit=take.captions.get("credit", "")),
    ]


def gif(take: Take) -> list[Shot]:
    """The README GIF: silent, loops, and its first frame (the finished state) tells the story."""
    typing, added, ticked, end = (take.mark(m) for m in ("typing", "added", "ticked", "end"))
    whole = take.around("app", end["box"], pad=48)
    return [
        take.still("app", end["t"], 1.8, whole, key="open"),
        take.clip("app", typing["t"] - 0.3, typing["t"] + 2.4, crop=whole, key="type", top=True),
        take.clip("app", added["t"] - 0.4, added["t"] + 1.6, crop=whole, key="added"),
        take.clip("app", ticked["t"] - 0.3, ticked["t"] + 1.8, crop=whole, key="ticked"),
        take.still("app", end["t"], 2.2, whole, key="open"),
    ]


if __name__ == "__main__":
    cut.main(shots, name="demo", make_gif=gif, description=__doc__.split("\n\n")[0])
