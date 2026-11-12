#!/usr/bin/env python3
"""Start a demo video project from the template.

    python3 new_project.py <folder> [--url URL] [--name NAME]

Copies record.py (the scenario), edit.py (the cut) and captions.json into <folder>, with this
kit's path filled in. Without --url it adds the sample app and the scenario records it, so the
whole pipeline can be tried before writing your own. Keep the folder in the kit's projects/
(git-ignored, since it names your product) or anywhere that isn't a scratch directory.
"""

import argparse
import re
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
TEMPLATE = SCRIPTS.parent / "assets" / "template"

ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
ap.add_argument("folder", type=Path, help="the new project's folder, for example projects/acme")
ap.add_argument("--url", default="", help="your app's URL (omit it to record the bundled sample app)")
ap.add_argument("--name", default="", help="the product's name, for the cards (default: the folder's name)")
args = ap.parse_args()

dest = args.folder.expanduser().resolve()
if dest.exists() and any(dest.iterdir()):
    sys.exit(f"{dest} exists and isn't empty")
name = args.name or dest.name
if not re.fullmatch(r"[\w .,&+-]+", name):
    sys.exit("pick a --name of letters, digits, spaces and . , & + - only")
if args.url and not re.fullmatch(r"(https?|file)://\S+", args.url):
    sys.exit("--url must be an http(s):// or file:// URL")
dest.mkdir(parents=True, exist_ok=True)
for src in sorted(TEMPLATE.iterdir()):
    if src.name == "app.html" and args.url:
        continue
    text = src.read_text().replace("__SCRIPTS__", str(SCRIPTS)).replace("__URL__", args.url).replace("__NAME__", name)
    (dest / src.name).write_text(text)

slug = re.sub(r"[^\w-]+", "-", name.lower()).strip("-") or "demo"
take = f"~/recordings/{slug}/take-1"
print(f"""Created {dest}:
  record.py      the scenario: {"rewrite its steps for " + args.url if args.url else "it records the sample app (app.html) as it is"}
  edit.py        the cut: shots from the scenario's marks, the cards, the GIF
  captions.json  a starting point; each take gets its own copy, to edit after watching it

Next:
  cd {dest}
  uv run record.py --build {take} --dry     # screenshots of each window, nothing recorded
  uv run record.py --build {take}
  uv run edit.py --build {take} --stills""")
