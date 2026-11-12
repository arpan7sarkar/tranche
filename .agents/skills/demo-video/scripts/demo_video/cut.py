"""Cut a demo video (and a README GIF) from a recorded take.

Every frame comes from the recordings, as they played. Editing here is choosing moments,
framing them (crops from the page's real layout, slow camera moves), speeding up waits (with a
badge that says so), cutting between windows, and adding short captions, a splash and an end
card, narration and music. Nothing on screen is redrawn.

An edit is a function from a Take to a list of shots:

    def shots(take):
        end, typing = take.mark("end"), take.mark("typing")
        return [
            cut.title_card("Acme", "Invoices that chase themselves."),
            take.still("app", end["t"], 3.0, key="open"),
            take.clip("app", typing["t"] - 0.5, typing["t"] + 3.5, crop=take.around("app", typing["box"]),
                      key="task", top=True),
            cut.end_card("Acme", "Invoices that chase themselves.", lines=["pip install acme"], url="acme.dev"),
        ]

    if __name__ == "__main__":
        cut.main(shots)

Captions come from the take's captions.json, by shot key; see references/editing.md.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator

from PIL import Image, ImageDraw, ImageFont

from . import sound

W, H, FPS = 1920, 1080, 30
AR = W / H
CRF = 22  # keeps about 45 s of 1080p under GitHub's 10 MB
GIF_W, GIF_FPS = 960, 12
BG = (17, 19, 22)
INK = (240, 242, 245)
INK_2 = (160, 166, 173)
ACCENT = (126, 206, 142)
MAX_CAPTION_WORDS = 6

Crop = tuple[float, float, float, float]


def log(*a: Any) -> None:
    print(*a, flush=True)


# ------------------------------------------------------------------ fonts and colours
_FALLBACK = {
    "sans": ["/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"],
    "bold": ["/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"],
    "mono": ["/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf",
             "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"],
}
_PATTERN = {"sans": "Noto Sans:style=Regular", "bold": "Noto Sans:style=Bold", "mono": "Noto Sans Mono"}


@lru_cache(maxsize=None)
def _font_file(kind: str) -> str | None:
    for path in _FALLBACK[kind]:
        if Path(path).exists():
            return path
    if shutil.which("fc-match"):
        r = subprocess.run(["fc-match", "-f", "%{file}", _PATTERN[kind]], capture_output=True, text=True)
        if r.returncode == 0 and Path(r.stdout.strip()).exists():
            return r.stdout.strip()
    return None


@lru_cache(maxsize=None)
def font(kind: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """kind: "sans", "bold" or "mono" (Noto, else DejaVu, else whatever fontconfig finds)."""
    path = _font_file(kind)
    return ImageFont.truetype(path, size) if path else ImageFont.load_default(size)


def rgb(c: str | tuple[int, int, int]) -> tuple[int, int, int]:
    if isinstance(c, tuple):
        return c
    c = c.lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


# ------------------------------------------------------------------ geometry
def ease(u: float) -> float:
    u = min(max(u, 0.0), 1.0)
    return u * u * (3 - 2 * u)


def lerp(a: Iterable[float], b: Iterable[float], u: float) -> Crop:
    return tuple(p + (q - p) * u for p, q in zip(a, b))  # type: ignore[return-value]


def fit_crop(box: Iterable[float], aspect: float, bounds: tuple[float, float]) -> Crop:
    """The smallest crop with this aspect that holds `box`, moved inside (0, 0, *bounds)."""
    x0, y0, x1, y1 = box
    w, h = max(x1 - x0, 1.0), max(y1 - y0, 1.0)
    if w / h < aspect:
        w = h * aspect
    else:
        h = w / aspect
    bw, bh = bounds
    if w > bw:
        w, h = bw, bw / aspect
    if h > bh:
        w, h = bh * aspect, bh
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    x = min(max(cx - w / 2, 0), bw - w)
    y = min(max(cy - h / 2, 0), bh - h)
    return x, y, x + w, y + h


def union(*boxes: Iterable[float] | None) -> Crop:
    """The box around several boxes (for example a form and the list it adds to); None is skipped."""
    bs = [tuple(b) for b in boxes if b]
    if not bs:
        raise ValueError("union() of no boxes")
    return min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs)


def zoom_in(crop: Crop, k: float) -> Crop:
    """The same crop, k times tighter about its centre: a slow push-in when used as `to`."""
    x0, y0, x1, y1 = crop
    cx, cy, w, h = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / k, (y1 - y0) / k
    return cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2


def frame_of(src: Image.Image, crop: Crop, size: tuple[int, int] = (W, H)) -> Image.Image:
    """`crop` of a source frame (its pixels), scaled to fill `size`. A crop that runs past the
    frame's edge is moved back inside (and shrunk, keeping its aspect, if it's bigger)."""
    x0, y0, x1, y1 = crop
    k = min(1.0, src.width / (x1 - x0), src.height / (y1 - y0))
    cx, cy, w, h = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * k, (y1 - y0) * k
    x = min(max(cx - w / 2, 0), src.width - w)
    y = min(max(cy - h / 2, 0), src.height - h)
    return src.resize(size, Image.LANCZOS, box=(x, y, x + w, y + h))


# ------------------------------------------------------------------ sources
class Source:
    """One recording. Frames are read in order, by wall-clock time (the recordings keep it)."""

    def __init__(self, path: Path) -> None:
        if not path.exists():
            sys.exit(f"{path} not found")
        self.path = path
        info = json.loads(subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
             "stream=width,height:format=start_time", "-of", "json", str(path)],
            capture_output=True, text=True, check=True).stdout)
        self.w = info["streams"][0]["width"]
        self.h = info["streams"][0]["height"]
        self.start = float(info["format"]["start_time"])
        self._proc: subprocess.Popen[bytes] | None = None
        self._t = 0.0  # the wall-clock time of the frame in self._frame
        self._frame: Image.Image | None = None

    def _open(self, t: float) -> None:
        self.close()
        off = max(0.0, t - self.start)
        self._proc = subprocess.Popen(
            ["ffmpeg", "-v", "quiet", "-ss", f"{off:.3f}", "-i", str(self.path), "-f", "rawvideo",
             "-pix_fmt", "rgb24", "-r", str(FPS), "-"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self._t = self.start + off - 1 / FPS
        self._frame = None

    def at(self, t: float) -> Image.Image:
        """The frame showing at wall-clock time t (reading forward; a jump back reopens)."""
        if self._proc is None or t < self._t - 0.5 / FPS or t > self._t + 5:
            self._open(t)
        assert self._proc is not None and self._proc.stdout is not None
        n = self.w * self.h * 3
        while self._frame is None or self._t + 1 / FPS <= t + 1e-6:
            data = self._proc.stdout.read(n)
            if len(data) < n:
                break
            self._frame = Image.frombuffer("RGB", (self.w, self.h), data)
            self._t += 1 / FPS
        if self._frame is None:
            raise RuntimeError(f"no frame at {t:.3f} in {self.path.name} (it starts at {self.start:.3f})")
        return self._frame

    def close(self) -> None:
        if self._proc is not None:
            self._proc.kill()
            self._proc.wait()
            self._proc = None


# ------------------------------------------------------------------ shots
@dataclass
class Shot:
    """`dur` seconds of video: draw(u) renders the W x H frame at u in [0, 1)."""
    dur: float
    draw: Callable[[float], Image.Image]
    caption: str = ""
    key: str = ""             # its name in captions.json, for the caption and the narration
    top: bool = False         # the caption goes at the top (it would hide what's below)
    span: float = 0.0         # seconds of real time the shot covers: more than dur means sped up
    card: bool = False        # a title or end card (left out of the GIF)

    def badge(self) -> str:
        speed = self.span / self.dur if self.dur else 0.0
        return f"{speed:.0f}× speed" if speed >= 1.5 else ""


class Take:
    """A recorded take, for the edit: its recordings, marks, window sizes and captions."""

    def __init__(self, build: Path) -> None:
        self.build = build
        tl = build / "timeline.jsonl"
        if not tl.exists():
            sys.exit(f"{tl} not found: record a take first (record.py --build {build})")
        self.records = [json.loads(x) for x in tl.read_text().splitlines() if x.strip()]
        self.all_marks = [r for r in self.records if r.get("kind") == "mark"]
        self.views = json.loads((build / "views.json").read_text())
        cap = build / "captions.json"
        self.captions: dict[str, Any] = json.loads(cap.read_text()) if cap.exists() else {}
        self._sources: dict[str, Source] = {}

    # ---------------------------------------------------------------- marks
    def marks(self, what: str | None = None, **match: Any) -> list[dict[str, Any]]:
        return [m for m in self.all_marks
                if (what is None or m["what"] == what) and all(m.get(k) == v for k, v in match.items())]

    def mark(self, what: str, n: int = 0, **match: Any) -> dict[str, Any]:
        """The n-th mark called `what` (matching any extra fields given); its "t" is wall-clock time."""
        found = self.marks(what, **match)
        if len(found) <= n:
            names = sorted({m["what"] for m in self.all_marks})
            raise KeyError(f"no mark {what!r} (#{n}) in {self.build.name}; the take has: {', '.join(names)}")
        return found[n]

    def first(self, what: str, **match: Any) -> dict[str, Any] | None:
        found = self.marks(what, **match)
        return found[0] if found else None

    def term_text(self, pane: str, t: float) -> str:
        """A terminal's text as it was at time t."""
        text = ""
        for r in self.records:
            if r.get("kind") == "term" and r["pane"] == pane:
                if r["t"] > t:
                    break
                text = r["text"]
        return text

    # ---------------------------------------------------------------- framing (source pixels)
    def source(self, name: str) -> Source:
        if name not in self._sources:
            self._sources[name] = Source(self.build / f"{name}.mkv")
        return self._sources[name]

    def view(self, name: str) -> tuple[float, float, float]:
        """A window's CSS width, height and device scale."""
        v = self.views[name]
        return float(v["css"][0]), float(v["css"][1]), float(v["scale"])

    def full(self, name: str) -> Crop:
        """The whole window (cropped to 16:9 about its centre if it isn't 16:9)."""
        w, h, s = self.view(name)
        return fit_crop((0, 0, w * s, h * s), AR, (w * s, h * s))

    def around(self, name: str, box: Iterable[float], pad: float = 24.0, min_w: float = 0.0) -> Crop:
        """The smallest 16:9 crop holding `box` (CSS px, as marks carry it) plus `pad`, at least
        `min_w` CSS px wide (so a small element isn't blown up past legibility)."""
        w, h, s = self.view(name)
        x0, y0, x1, y1 = box
        x0, y0, x1, y1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
        if x1 - x0 < min_w:
            cx = (x0 + x1) / 2
            x0, x1 = cx - min_w / 2, cx + min_w / 2
        c = fit_crop((x0, y0, x1, y1), AR, (w, h))
        return c[0] * s, c[1] * s, c[2] * s, c[3] * s

    def rows(self, pane: str, r0: float, r1: float, zoom: float = 1.25) -> Crop:
        """A 16:9 crop of a terminal window, left-aligned, centred on rows r0..r1, `zoom` times
        closer than the whole window."""
        w, h, s = self.view(pane)
        cell = self.views["cells"][pane]
        cw = w * s / zoom
        ch = cw / AR
        cy = (cell["y"] + (r0 + r1) / 2 * cell["h"]) * s
        y = min(max(cy - ch / 2, 0), h * s - ch)
        return 0.0, y, cw, y + ch

    # ---------------------------------------------------------------- shots
    def clip(self, name: str, t0: float, t1: float, dur: float | None = None, crop: Crop | None = None,
             to: Crop | None = None, key: str = "", caption: str = "", top: bool = False) -> Shot:
        """Window `name` from wall-clock t0 to t1, over `dur` seconds (default: real time; shorter
        speeds it up, and the shot says so), the camera moving from `crop` to `to`."""
        src = self.source(name)
        c0 = crop or self.full(name)
        c1 = to or c0
        dur = dur if dur is not None else max(t1 - t0, 0.1)

        def draw(u: float) -> Image.Image:
            return frame_of(src.at(t0 + (t1 - t0) * u), lerp(c0, c1, ease(u)))
        return Shot(dur, draw, caption, key, top, span=t1 - t0)

    def still(self, name: str, t: float, dur: float = 3.0, crop: Crop | None = None, to: Crop | None = None,
              key: str = "", caption: str = "", top: bool = False) -> Shot:
        """One moment held (a cold open on the finished state, a closing frame)."""
        src = self.source(name)
        c0 = crop or self.full(name)
        c1 = to or c0
        cache: dict[str, Image.Image] = {}

        def draw(u: float) -> Image.Image:
            if "f" not in cache:
                cache["f"] = src.at(t).copy()
            return frame_of(cache["f"], lerp(c0, c1, ease(u)))
        return Shot(dur, draw, caption, key, top)

    def split(self, names: list[str], t0: float, t1: float, dur: float | None = None, width: float = 1.0,
              key: str = "", caption: str = "", top: bool = False) -> Shot:
        """Several windows side by side at the same moment (each its left `width` fraction): one
        thing reaching two places at once, without cutting back and forth."""
        srcs = [self.source(n) for n in names]
        k = len(srcs)
        pane_w = W // k - 12
        dur = dur if dur is not None else max(t1 - t0, 0.1)

        def draw(u: float) -> Image.Image:
            img = Image.new("RGB", (W, H), BG)
            tt = t0 + (t1 - t0) * u
            for i, src in enumerate(srcs):
                cw = src.w * width
                ph = min(round(pane_w * src.h / cw), H - 40)
                part = src.at(tt).resize((pane_w, ph), Image.LANCZOS, box=(0, 0, cw, src.h))
                img.paste(part, (8 + i * (W // k), (H - ph) // 2))
            return img
        return Shot(dur, draw, caption, key, top, span=t1 - t0)


def card(img: Image.Image, dur: float, key: str) -> Shot:
    return Shot(dur, lambda u: img, key=key, card=True)


def title_card(title: str, tagline: str = "", icon: str | Path | None = None, dur: float = 4.0,
               key: str = "splash") -> Shot:
    """The opening card: icon, name, tagline. No fade-in: GitHub shows a README video paused on
    its first frame, so frame one is the card. Play the music's lead-in under it."""
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    f = font("bold", 120)
    tw = d.textlength(title, font=f)
    size, gap = (200, 44) if icon else (0, 0)
    x0 = (W - (size + gap + tw)) / 2
    y = H / 2 - 60
    if icon:
        ic = Image.open(icon).convert("RGBA").resize((size, size), Image.LANCZOS)
        img.paste(ic, (int(x0), int(y - size / 2)), ic)
    d.text((x0 + size + gap, y - 120 * 0.72), title, font=f, fill=INK)
    if tagline:
        f2 = font("sans", 46)
        d.text(((W - d.textlength(tagline, font=f2)) / 2, y + 120), tagline, font=f2, fill=INK_2)
    return card(img, dur, key)


def end_card(title: str, tagline: str = "", lines: Iterable[str] = (), url: str = "", credit: str = "",
             dur: float = 3.6, key: str = "card", accent: str | tuple[int, int, int] = ACCENT) -> Shot:
    """The closing card: name, tagline, the install lines (as shell commands), the URL, and the
    music's credit line when the track needs one (Creative Commons Attribution tracks do)."""
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    lines = list(lines)
    y = 250 if lines else 340
    f = font("bold", 110)
    d.text(((W - d.textlength(title, font=f)) / 2, y), title, font=f, fill=INK)
    y += 150
    if tagline:
        f2 = font("sans", 44)
        d.text(((W - d.textlength(tagline, font=f2)) / 2, y), tagline, font=f2, fill=INK)
        y += 110
    if lines:
        mono = font("mono", 36)
        bw = max(d.textlength("$ " + ln, font=mono) for ln in lines) + 80
        bx = (W - bw) / 2
        d.rounded_rectangle((bx, y, bx + bw, y + 60 * len(lines) + 50), radius=18, fill=(26, 29, 33))
        for i, ln in enumerate(lines):
            d.text((bx + 40, y + 28 + 60 * i), "$ ", font=mono, fill=rgb(accent))
            d.text((bx + 40 + d.textlength("$ ", font=mono), y + 28 + 60 * i), ln, font=mono, fill=INK)
        y += 60 * len(lines) + 90
    if url:
        f3 = font("bold", 44)
        d.text(((W - d.textlength(url, font=f3)) / 2, min(y, 870)), url, font=f3, fill=rgb(accent))
    if credit:
        f4 = font("sans", 24)
        d.text(((W - d.textlength(credit, font=f4)) / 2, H - 60), credit, font=f4, fill=INK_2)
    return card(img, dur, key)


# ------------------------------------------------------------------ captions and badges
def draw_caption(img: Image.Image, text: str, alpha: float = 1.0, size: int = 50, top: bool = False,
                 colors: dict[str, tuple[int, int, int]] | None = None) -> None:
    """A caption in a dark pill at the bottom (or top), names in their colours."""
    if not text or alpha <= 0:
        return
    import re
    d = ImageDraw.Draw(img, "RGBA")
    f = font("bold", size)
    while d.textlength(text, font=f) > img.width * 0.88 and size > 16:  # long captions shrink to fit
        size -= 2
        f = font("bold", size)
    tw = d.textlength(text, font=f)
    k = size / 50
    padx, pady = 34 * k, 18 * k
    w, h = tw + 2 * padx, size * 1.25 + 2 * pady
    x0, y0 = (img.width - w) / 2, (56 * k if top else img.height - h - 56 * k)
    d.rounded_rectangle((x0, y0, x0 + w, y0 + h), radius=h / 2, fill=(12, 13, 15, int(225 * alpha)))
    x, y = x0 + padx, y0 + pady - size * 0.08
    colors = colors or {}
    parts = re.split("(" + "|".join(map(re.escape, sorted(colors, key=len, reverse=True))) + ")", text) \
        if colors else [text]
    for part in parts:
        col = colors.get(part, INK)
        d.text((x, y), part, font=f, fill=col + (int(255 * alpha),))
        x += d.textlength(part, font=f)


def draw_badge(img: Image.Image, text: str, alpha: float = 1.0) -> None:
    """A small tag in the top-right corner: the speed-up, so a sped-up wait is never a secret."""
    if not text or alpha <= 0:
        return
    k = img.height / H
    f = font("bold", max(12, int(26 * k)))
    d = ImageDraw.Draw(img, "RGBA")
    tw = d.textlength(text, font=f)
    x1, y0 = img.width - 40 * k, 36 * k
    d.rounded_rectangle((x1 - tw - 36 * k, y0, x1, y0 + 48 * k), radius=24 * k, fill=(12, 13, 15, int(200 * alpha)))
    d.text((x1 - tw - 18 * k, y0 + 8 * k), text, font=f, fill=INK_2 + (int(255 * alpha),))


def play(shots: list[Shot], fps: int, fade: float = 0.25, caption_size: int = 50,
         colors: dict[str, tuple[int, int, int]] | None = None) -> Iterator[Image.Image]:
    """The shots in order, each cross-fading into the next over `fade` s. A caption that changes
    fades out and the next fades in, rather than overlapping."""
    for k, s in enumerate(shots):
        n = max(1, round(s.dur * fps))
        nxt = shots[k + 1] if k + 1 < len(shots) else None
        nf = round(fade * fps) if nxt is not None else 0
        incoming = None
        for i in range(n):
            img = s.draw(i / n).copy()
            cap, cap_a, top = s.caption, 1.0, s.top
            if nxt is not None and i >= n - nf:
                v = ease((i - (n - nf) + 1) / (nf + 1))
                if incoming is None:
                    incoming = nxt.draw(0.0)
                img = Image.blend(img, incoming, v)
                if (nxt.caption, nxt.top) != (s.caption, s.top):
                    if v < 0.5:
                        cap_a = 1 - 2 * v
                    else:
                        cap, cap_a, top = nxt.caption, 2 * v - 1, nxt.top
            draw_caption(img, cap, cap_a, caption_size, top, colors)
            draw_badge(img, s.badge())
            yield img


# ------------------------------------------------------------------ output
def encode_mp4(frames: Iterable[Image.Image], out: Path, fps: int = FPS) -> float:
    """H.264 at CRF 22, no audio yet; returns the length in seconds."""
    ff = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(fps),
         "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", str(CRF), "-pix_fmt", "yuv420p", "-an",
         "-movflags", "+faststart", str(out)], stdin=subprocess.PIPE)
    assert ff.stdin is not None
    n = 0
    for img in frames:
        ff.stdin.write(img.tobytes())
        n += 1
    ff.stdin.close()
    if ff.wait() != 0:
        sys.exit("ffmpeg failed (mp4)")
    return n / fps


def mux(video: Path, audio_dir: Path, out: Path, stems: bool = False) -> None:
    """The video with mix.wav as its audio; with `stems`, narration and music ride along as
    extra tracks (players play the first, the default)."""
    inputs = ["-i", str(video), "-i", str(audio_dir / "mix.wav")]
    maps = ["-map", "0:v", "-map", "1:a"]
    meta = ["-metadata:s:a:0", "title=mix", "-metadata:s:a:0", "handler_name=mix"]
    k = 2
    for name in ("narration", "music") if stems else ():
        if (audio_dir / f"{name}.wav").exists():
            inputs += ["-i", str(audio_dir / f"{name}.wav")]
            maps += ["-map", f"{k}:a"]
            meta += [f"-metadata:s:a:{k - 1}", f"title={name}", f"-metadata:s:a:{k - 1}", f"handler_name={name}"]
            k += 1
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, *maps, "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
                        *meta, "-disposition:a:0", "default", "-shortest", "-movflags", "+faststart", str(out)])
    if r.returncode != 0:
        sys.exit("ffmpeg failed (audio)")


def encode_gif(frames: Iterable[Image.Image], out: Path, fps: int = GIF_FPS, width: int = GIF_W) -> None:
    """A looping GIF (one 128-colour palette for the whole thing, no dithering: crisp UI text)."""
    size = (width, round(width / AR))
    ff = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{size[0]}x{size[1]}",
         "-r", str(fps), "-i", "-", "-vf",
         "split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
         "-loop", "0", str(out)], stdin=subprocess.PIPE)
    assert ff.stdin is not None
    for img in frames:
        ff.stdin.write(img.resize(size, Image.LANCZOS).tobytes())
    ff.stdin.close()
    if ff.wait() != 0:
        sys.exit("ffmpeg failed (gif)")


def size_note(path: Path, max_mb: float) -> str:
    mb = path.stat().st_size / 1e6
    note = f"{path}: {mb:.1f} MB"
    if mb > max_mb:
        note += f"  -- over {max_mb:.0f} MB: GitHub won't take it. Shorten the cut or lower GIF_W/fps before raising CRF."
    return note


# ------------------------------------------------------------------ the command line
def apply_captions(shots: list[Shot], caps: dict[str, Any]) -> None:
    for s in shots:
        if s.key and isinstance(caps.get(s.key), str):
            s.caption = caps[s.key]


def write_commands(take: Take, out: Path) -> Path | None:
    """The lines typed on camera, in order, as out/commands.txt: hand them over with the video so
    the commands people copy are the ones they watched. None if the take typed nothing."""
    typed = [r for r in take.records if r.get("kind") == "typed"]
    if not typed:
        return None
    panes = {r["pane"] for r in typed}
    path = out / "commands.txt"
    path.write_text("".join((f"[{r['pane']}] " if len(panes) > 1 else "") + r["text"] + "\n" for r in typed))
    return path


def fingerprint(args: argparse.Namespace, lines: list[dict[str, Any]], shots: list[Shot]) -> str:
    """What the soundtrack is made of: if any of it changes, the approved mix no longer applies."""
    music = args.music.expanduser().resolve() if args.music else None
    blob = {
        "voice": args.voice, "speed": args.voice_speed, "lead_in": args.lead_in,
        "lufs": [args.voice_lufs, args.music_lufs],
        "music": [str(music), music.stat().st_size, int(music.stat().st_mtime)] if music else None,
        "music_start": args.music_start,
        "lines": [[ln["text"], ln["at"]] for ln in lines],
        "durs": [round(s.dur, 3) for s in shots],
    }
    return hashlib.sha256(json.dumps(blob, sort_keys=True).encode()).hexdigest()[:16]


def main(make_shots: Callable[[Take], list[Shot]], name: str = "demo",
         make_gif: Callable[[Take], list[Shot]] | None = None, description: str | None = None) -> None:
    """The command line for an edit.py. Run --stills first, then --audio-only (and get the mix
    approved), then the render with --audio-approved."""
    ap = argparse.ArgumentParser(description=description)
    ap.add_argument("--build", type=Path, required=True, help="the take's folder")
    ap.add_argument("--name", default=name, help=f"the output files' name (default: {name})")
    ap.add_argument("--stills", action="store_true", help="one frame per shot in out/stills/, and the timings")
    ap.add_argument("--audio-only", action="store_true",
                    help="only the soundtrack: out/mix.wav, with narration.wav and music.wav beside it")
    ap.add_argument("--audio-approved", action="store_true",
                    help="a person approved out/mix.wav as it is: needed to render a video with narration or music")
    ap.add_argument("--voice", default="", help="narrate captions.json's \"voice\" passages with this Kokoro voice")
    ap.add_argument("--voice-speed", type=float, default=1.0)
    ap.add_argument("--music", type=Path, help="the music track (bring one you may use, and credit it)")
    ap.add_argument("--music-start", type=float, default=0.0, help="where in the track to start (s)")
    ap.add_argument("--lead-in", type=float, default=4.0,
                    help="music alone before the first spoken line (s): end it on a pause in the track")
    ap.add_argument("--voice-lufs", type=float, default=-16.0)
    ap.add_argument("--music-lufs", type=float, default=-23.0)
    ap.add_argument("--stems", action="store_true", help="carry narration and music as extra audio tracks too")
    ap.add_argument("--gif", action="store_true", help="also render the README GIF (silent, loops)")
    ap.add_argument("--gif-only", action="store_true", help="only the GIF")
    ap.add_argument("--max-mb", type=float, default=10.0, help="warn above this size (GitHub's upload limit)")
    args = ap.parse_args()
    build = args.build.expanduser().resolve()
    starter = Path(sys.argv[0]).resolve().parent / "captions.json"
    if (build / "timeline.jsonl").exists() and not (build / "captions.json").exists() and starter.exists():
        shutil.copy(starter, build / "captions.json")
        log(f"copied {starter.name} into the take: edit {build / 'captions.json'} after watching the take")
    take = Take(build)
    out = build / "out"
    out.mkdir(exist_ok=True)
    commands = write_commands(take, out)
    if commands:
        log(f"the lines typed on camera: {commands}")
    shots = make_shots(take)
    caps = take.captions
    if not (build / "captions.json").exists():
        caps = {s.key: s.caption for s in shots if s.key and not s.card}
        caps["voice"] = {}
        (build / "captions.json").write_text(json.dumps(caps, indent=1, ensure_ascii=False) + "\n")
        log(f"wrote a draft {build / 'captions.json'}: write the captions (and any narration) after watching the take")
    apply_captions(shots, caps)
    colors = {k: rgb(v) for k, v in (caps.get("colors") or {}).items()}
    for s in shots:
        if len(s.caption.split()) > MAX_CAPTION_WORDS:
            log(f"caption {s.key!r} has {len(s.caption.split())} words (keep it to {MAX_CAPTION_WORDS}): {s.caption!r}")

    if args.stills:
        d = out / "stills"
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir()
        t = 0.0
        timings = []
        for k, s in enumerate(shots):
            img = s.draw(0.5).copy()
            draw_caption(img, s.caption, 1.0, 50, s.top, colors)
            draw_badge(img, s.badge())
            img.resize((960, 540), Image.LANCZOS).save(d / f"{k:02d}-{s.key or 'shot'}.png")
            log(f"{k:2d}  {t:5.1f}s  {s.dur:4.1f}s  {s.key or '-':12s} {s.caption}")
            timings.append({"key": s.key, "start": round(t, 3), "dur": round(s.dur, 3), "card": s.card})
            t += s.dur
        (out / "shots.json").write_text(json.dumps(timings, indent=1) + "\n")   # for scripts/chiptune.py --shots
        log(f"{len(shots)} shots, {t:.1f} s; stills in {d} (narration, if any, will stretch some beats)")
        return

    wants_audio = bool(args.voice or args.music)
    lines: list[dict[str, Any]] = []
    if args.voice:
        lines = sound.narrate(shots, caps.get("voice") or {}, args.voice, args.voice_speed, out / "voice", args.lead_in)
    elif caps.get("voice"):
        log("captions.json has narration passages, but no --voice was given: captions only")
    total = sum(s.dur for s in shots)
    fp = fingerprint(args, lines, shots) if wants_audio else ""

    if args.audio_only:
        if not wants_audio:
            sys.exit("--audio-only needs --voice and/or --music")
        sound.soundtrack(total, out, args.music, args.music_start, lines, args.voice_lufs, args.music_lufs)
        (out / "audio.json").write_text(json.dumps({"fingerprint": fp, "length_s": round(total, 2),
                                                     "voice": args.voice, "music": str(args.music or "")}, indent=1))
        log(sound.report(out))
        stems = [n for n in ("narration.wav", "music.wav") if (out / n).exists()]
        log(f"\nSend {out / 'mix.wav'}" + (f" (and {', '.join(stems)})" if stems else "") + " to the person for a "
            "listen, and wait for their OK. Then render with the same options plus --audio-approved.")
        return
    if wants_audio:
        if not args.audio_approved:
            sys.exit("Approve audio as audio first: run with --audio-only, send out/mix.wav (and the stems) for a "
                     "listen, then render with the same options plus --audio-approved once the person says yes.")
        meta = out / "audio.json"
        approved = json.loads(meta.read_text()).get("fingerprint") if meta.exists() else None
        if approved != fp or not (out / "mix.wav").exists():
            sys.exit("The soundtrack changed since the mix that was approved (narration, music, levels or shot "
                     "timings). Run --audio-only again and get the new mix approved.")

    if not args.gif_only:
        final = out / f"{args.name}.mp4"
        silent = out / f"{args.name}.silent.mp4"
        length = encode_mp4(play(shots, FPS, colors=colors), silent)
        if wants_audio:
            mux(silent, out, final, args.stems)
            silent.unlink()
        else:
            silent.replace(final)
        log(f"{size_note(final, args.max_mb)}, {length:.1f} s")
    if args.gif or args.gif_only:
        gshots = make_gif(take) if make_gif else [s for s in shots if not s.card]
        apply_captions(gshots, caps)
        gif = out / f"{args.name}.gif"
        encode_gif(play(gshots, GIF_FPS, caption_size=60, colors=colors), gif)
        log(size_note(gif, args.max_mb))
