# /// script
# requires-python = ">=3.10"
# dependencies = ["websockets>=13", "pillow", "numpy"]
# ///
"""Record the __NAME__ demo from a real run, as screen video.

    uv run record.py --build ~/recordings/__NAME__/take-1 --dry   # open the windows, screenshot, stop
    uv run record.py --build ~/recordings/__NAME__/take-1         # a take (use take-2, take-3, … next)

The scenario plays the human and marks every moment the edit needs, with the boxes to frame.
Out of the box it drives the sample app beside this file. For your app, set URL and rewrite the
steps, keeping the shape: the prepared state off camera, take.ready(), then the story.
"""

import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, "__SCRIPTS__")  # the kit's scripts folder (new_project.py filled this in)

from demo_video.record import Take, run  # noqa: E402

URL = "__URL__"  # your app; empty records the sample app beside this file


def scenario(take: Take) -> None:
    # 1. The prepared state, off camera: open the app, sign in, load the data. Never record
    #    installs, logins or empty screens. Use a demo account and made-up data.
    app = take.window("app", URL or (HERE / "app.html").as_uri(), css=(1280, 720), scale=2.0, color_scheme="dark")
    app.wait_for("#new")
    take.ready()  # --dry stops here, with a screenshot of each window; otherwise recording starts

    # 2. The story. Play the human at a person's pace, and mark each moment the edit cuts to,
    #    with the box (CSS px) to frame it by.
    time.sleep(1.5)
    take.mark("start", box=app.box("main"))
    app.click("#new")
    take.mark("typing", box=app.box("#add"))
    app.type("Ship the demo", cps=11)  # about 11 characters a second reads as typing
    time.sleep(0.6)
    app.press("Enter")
    app.wait_for_text("#list", "Ship the demo")
    take.mark("added", box=app.box("#list"))
    time.sleep(2.0)
    app.click("#list li:nth-child(2) input")
    take.mark("ticked", box=app.box("#list"), count=app.box("#count"))
    time.sleep(2.5)

    # 3. The finished state, held: the cold open and the GIF's first frame come from here.
    take.mark("end", box=app.box("main"))
    time.sleep(1.5)


if __name__ == "__main__":
    run(scenario, description=__doc__.split("\n\n")[0])
