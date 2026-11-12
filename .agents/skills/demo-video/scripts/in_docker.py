#!/usr/bin/env python3
"""Run a kit command in Docker, for recording on macOS.

    python3 in_docker.py python3 check_env.py --deep
    python3 in_docker.py uv run record.py --build ~/recordings/sample/take-1
    python3 in_docker.py uv run edit.py --build ~/recordings/sample/take-1 --gif

A Mac can't run the recorder itself: Chrome for Mac can't draw on a virtual X display, and
Homebrew's ffmpeg has no x11grab. Docker Desktop's Linux VM can. The first run builds the kit's
image from assets/docker/Dockerfile (a few minutes; again whenever the Dockerfile changes). Each
run gets the same paths as on the Mac: the skills folder (read-only, voice-over's included), the
current folder and ~/recordings, so a rig from new_project.py and a take's paths work unchanged.
Nothing else on the Mac is visible inside. The Mac's localhost is host.docker.internal inside.

DEMO_VIDEO_IMAGE names an image to use instead, for example one built FROM demo-video-kit with
the tools a terminal take types. Standard library only. On Linux, run the kit directly.
"""

import hashlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
DOCKERFILE = SKILL / "assets" / "docker" / "Dockerfile"
CACHE = "demo-video-cache"  # a named volume: uv's packages, the Kokoro venv, fontconfig's cache


def image() -> str:
    """The kit's image, built when the Dockerfile has changed since the last build."""
    tag = "demo-video-kit:" + hashlib.sha256(DOCKERFILE.read_bytes()).hexdigest()[:12]
    if subprocess.run(["docker", "image", "inspect", tag], capture_output=True).returncode != 0:
        print(f"in_docker: building {tag}; the first build takes a few minutes", file=sys.stderr)
        r = subprocess.run(["docker", "build", "-t", tag, "-t", "demo-video-kit:latest", str(DOCKERFILE.parent)])
        if r.returncode != 0:
            sys.exit("in_docker: the image didn't build (see above)")
    return tag


def mounts(wanted: list[tuple[Path, bool]]) -> list[tuple[Path, bool]]:
    """Each (folder, writable) at its own path inside, leaving out any a broader mount already gives."""
    kept: list[tuple[Path, bool]] = []
    for path, rw in sorted(wanted, key=lambda m: (len(m[0].parts), not m[1])):
        if not any(path.is_relative_to(p) and (prw or not rw) for p, prw in kept):
            kept.append((path, rw))
    return kept


def main() -> None:
    command = sys.argv[1:]
    if not command or command[0] in ("-h", "--help"):
        print(__doc__.strip())
        sys.exit(0 if command else 2)
    shutil.which("docker") or sys.exit("in_docker: no docker on PATH: install Docker Desktop")
    if subprocess.run(["docker", "info"], capture_output=True).returncode != 0:
        sys.exit("in_docker: Docker isn't running: start Docker Desktop")
    tag = os.environ.get("DEMO_VIDEO_IMAGE") or image()

    cwd = Path.cwd()
    if cwd in (Path.home(), Path("/")):
        sys.exit(f"in_docker: run it from the rig's folder (or the kit's), not {cwd}: the folder goes into the container")
    # paths on the command line as typed: no symlinks resolved, since that's how the container sees them
    paths = [Path(os.path.abspath(os.path.expanduser(v))) for v in (a.split("=", 1)[-1] for a in command)
             if v.startswith(("/", "~"))]
    wanted = [(SKILL.parent, False), (cwd, True)]   # the skills folder: this one and voice-over
    recordings = Path.home() / "recordings"
    if recordings.exists() or any(p.is_relative_to(recordings) for p in paths):
        recordings.mkdir(exist_ok=True)
        wanted.append((recordings, True))
    kept = mounts(wanted)
    for p in paths:
        if not any(p.is_relative_to(m) for m, _ in kept):
            print(f"in_docker: {p} isn't visible inside the container (only {', '.join(str(m) for m, _ in kept)})",
                  file=sys.stderr)

    args = ["docker", "run", "--rm", "--init", "-i", "--shm-size=1g",
            # Chrome's sandbox needs user namespaces, which Docker's default seccomp profile blocks;
            # --no-sandbox instead would draw a warning bar into every recorded frame
            "--security-opt", "seccomp=unconfined",
            "-v", f"{CACHE}:/cache", "-e", f"HOME={Path.home()}", "-w", str(cwd)]
    if sys.stdin.isatty() and sys.stdout.isatty():
        args.append("-t")
    for p, rw in kept:
        args += ["-v", f"{p}:{p}" + ("" if rw else ":ro")]
    os.execvp("docker", [*args, tag, *command])


main()
