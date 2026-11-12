#!/usr/bin/env python3
"""Check this machine can record, cut and narrate a demo video.

    python3 check_env.py          # what's installed
    python3 check_env.py --deep   # also open a virtual display, run Chrome on it and record a second

Standard library only. Exits 1 when something required is missing.
"""

import argparse
import os
import platform
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ok = True


def row(state: str, what: str, detail: str = "") -> None:
    global ok
    if state == "MISSING":
        ok = False
    print(f"{state:8s} {what:22s} {detail}")


def version(argv: list[str]) -> str:
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=20)
        return (r.stdout or r.stderr).strip().splitlines()[0] if (r.stdout or r.stderr).strip() else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


def find_chrome() -> str | None:
    for name in (os.environ.get("CHROME", ""), "google-chrome", "google-chrome-stable", "chromium",
                 "chromium-browser", "chrome"):
        if name and shutil.which(name):
            return shutil.which(name)
    return None


def x_up(n: int) -> bool:
    for addr in (f"\0/tmp/.X11-unix/X{n}", f"/tmp/.X11-unix/X{n}"):
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(0.5)
        try:
            s.connect(addr)
            return True
        except OSError:
            pass
        finally:
            s.close()
    return False


def deep(chrome: str) -> None:
    """A real one-second recording of Chrome on a virtual display: the whole rig in miniature."""
    n = next(k for k in range(90, 290) if not Path(f"/tmp/.X{k}-lock").exists() and not x_up(k))
    with tempfile.TemporaryDirectory(prefix="demo-video-check-", ignore_cleanup_errors=True) as tmp:
        xvfb = subprocess.Popen(["Xvfb", f":{n}", "-screen", "0", "640x360x24", "-nolisten", "tcp", "-nocursor"],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        chrome_p = None
        try:
            t0 = time.monotonic()
            while not x_up(n) and time.monotonic() - t0 < 10:
                time.sleep(0.1)
            if not x_up(n):
                row("MISSING", "virtual display", f"Xvfb :{n} did not come up")
                return
            row("ok", "virtual display", f":{n}")
            env = {k: v for k, v in os.environ.items() if k != "WAYLAND_DISPLAY"}
            env.update(DISPLAY=f":{n}", XDG_SESSION_TYPE="x11")
            page = "data:text/html,<body style='margin:0;background:%23e84;'></body>"
            chrome_p = subprocess.Popen([chrome, "--ozone-platform=x11", f"--app={page}", f"--user-data-dir={tmp}/prof",
                                         "--no-first-run", "--no-default-browser-check", "--window-position=0,0",
                                         "--window-size=640,360", "--force-device-scale-factor=1"],
                                        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                        start_new_session=True)
            time.sleep(4)
            out = Path(tmp) / "check.mkv"
            ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "x11grab", "-framerate", "30", "-video_size",
                                   "640x360", "-i", f":{n}", "-copyts", "-c:v", "libx264", "-preset", "ultrafast",
                                   str(out)], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            time.sleep(1.2)
            _, err = ff.communicate(b"q", timeout=20)
            # the middle pixel of the first frame, as raw RGB
            r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(out), "-frames:v", "1",
                                "-vf", "crop=1:1:320:180", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                               capture_output=True, timeout=20)
            px = r.stdout[:3]
            if len(px) < 3:
                row("MISSING", "recording", (err or b"").decode()[-200:] or "no frame came out")
                return
            painted = px[0] > 150 and px[0] > px[2] + 40  # the page's orange, give or take the encoding
            row("ok" if painted else "MISSING", "recording",
                "Chrome's page recorded" if painted else f"recorded, but Chrome's page isn't in it (pixel {tuple(px)})")
        finally:
            for p in (chrome_p, xvfb):
                if p is not None and p.poll() is None:
                    os.killpg(p.pid, 15)
                    try:
                        p.wait(10)
                    except subprocess.TimeoutExpired:
                        os.killpg(p.pid, 9)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--deep", action="store_true", help="also record one second of Chrome on a virtual display")
    args = ap.parse_args()
    if platform.system() == "Darwin":
        here = Path(__file__).resolve().parent
        row("MISSING", "Linux", f"macOS records in Docker: python3 {here / 'in_docker.py'} python3 {here / 'check_env.py'} --deep")
    else:
        row("ok" if platform.system() == "Linux" else "MISSING", "Linux", platform.platform())
    row("ok" if sys.version_info >= (3, 10) else "MISSING", "Python 3.10+", sys.version.split()[0])
    for tool, why in (("Xvfb", "virtual displays"), ("ffmpeg", "recording and encoding"), ("ffprobe", "reading takes")):
        row("ok" if shutil.which(tool) else "MISSING", tool, why if shutil.which(tool) else f"install it ({why})")
    if shutil.which("ffmpeg"):
        enc = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
        row("ok" if "libx264" in enc else "MISSING", "libx264", "H.264 encoder" if "libx264" in enc else "ffmpeg without libx264")
        filt = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True).stdout
        row("ok" if "ebur128" in filt else "MISSING", "ebur128", "loudness meter")
    chrome = find_chrome()
    row("ok" if chrome else "MISSING", "Chrome or Chromium", version([chrome, "--version"]) if chrome else
        "install it, or set CHROME to its path")
    row("ok" if shutil.which("uv") else "MISSING", "uv", version(["uv", "--version"]) or "https://docs.astral.sh/uv/")
    tmux = shutil.which("tmux")
    row("ok" if tmux else "optional", "tmux", version(["tmux", "-V"]) if tmux else "only to record terminals")
    fonts = [p for p in ("/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
                         "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf") if Path(p).exists()]
    row("ok" if fonts else "optional", "caption fonts", fonts[0] if fonts else "install fonts-noto-core (or DejaVu)")
    venv = Path(os.environ.get("KOKORO_VENV", "~/.venvs/kokoro")).expanduser()
    py = venv / "bin" / "python"
    if py.exists():
        r = subprocess.run([str(py), "-c", "import importlib.util as u, sys; sys.exit(0 if u.find_spec('kokoro') else 1)"])
        row("ok" if r.returncode == 0 else "optional", "Kokoro voice", f"{venv}" if r.returncode == 0 else
            f"{venv} has no kokoro: rerun the voice-over skill's setup_kokoro.sh")
    else:
        row("optional", "Kokoro voice", f"no venv at {venv}: only for narration (voice-over skill)")
    # Linux only: elsewhere Chrome would open on the real desktop
    if args.deep and platform.system() == "Linux" and chrome and shutil.which("Xvfb") and shutil.which("ffmpeg"):
        deep(chrome)
    print("\nready" if ok else "\nfix the MISSING rows first")
    sys.exit(0 if ok else 1)


main()
