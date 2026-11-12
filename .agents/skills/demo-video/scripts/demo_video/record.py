"""Record a demo from a real run, as screen video.

Every window is a Chrome app window on its own virtual X display (Xvfb), driven over the
DevTools protocol (CDP) and recorded by ffmpeg (x11grab with -copyts, so every file keeps
wall-clock time). The scenario plays the human (clicks, typing at reading pace) and marks what
happened when in timeline.jsonl, with the on-screen boxes the edit frames on. Nothing is mocked
or redrawn, and nothing is recorded from your real desktop.

A scenario is a function of a Take:

    def scenario(take):
        app = take.window("app", "http://localhost:3000", css=(1280, 720), scale=2.0)
        app.wait_for("#list")
        take.ready()                     # --dry stops here, with a screenshot per window
        app.click("#new")
        take.mark("typing", box=app.box("#new"))
        app.type("Ship the demo", cps=11)
        app.press("Enter")
        take.mark("added", box=app.box("#list"))

    if __name__ == "__main__":
        run(scenario)

Writes into the take's folder: one <window>.mkv per window, timeline.jsonl, views.json (each
window's CSS size and device scale), and the tools' logs.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable

FPS = 30
CRF = 14  # the raw take: near-lossless, so the edit has clean pixels to crop from
# key name -> (code, Windows virtual key code, text the key types)
KEYS = {
    "Enter": ("Enter", 13, "\r"), "Tab": ("Tab", 9, "\t"), "Escape": ("Escape", 27, ""),
    "Backspace": ("Backspace", 8, ""), "Delete": ("Delete", 46, ""), "Space": ("Space", 32, " "),
    "ArrowUp": ("ArrowUp", 38, ""), "ArrowDown": ("ArrowDown", 40, ""), "ArrowLeft": ("ArrowLeft", 37, ""),
    "ArrowRight": ("ArrowRight", 39, ""), "Home": ("Home", 36, ""), "End": ("End", 35, ""),
    "PageUp": ("PageUp", 33, ""), "PageDown": ("PageDown", 34, ""),
}


def log(*a: Any) -> None:
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def wait(pred: Callable[[], Any], timeout: float, what: str, step: float = 0.25) -> Any:
    """Poll pred until it returns something truthy; that value, or TimeoutError naming `what`."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        v = pred()
        if v:
            return v
        time.sleep(step)
    raise TimeoutError(f"timed out after {timeout:.0f} s waiting for {what}")


def find_chrome() -> str | None:
    for name in (os.environ.get("CHROME", ""), "google-chrome", "google-chrome-stable", "chromium",
                 "chromium-browser", "chrome"):
        if name and shutil.which(name):
            return shutil.which(name)
    return None


def x_up(n: int) -> bool:
    """Whether X display :n accepts connections. Xvfb listens on the abstract socket as well as
    /tmp/.X11-unix/Xn, and on WSL2 only on the abstract one (WSLg owns that folder)."""
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


def free_display(start: int = 90) -> int:
    for n in range(start, start + 200):
        if not Path(f"/tmp/.X{n}-lock").exists() and not x_up(n):
            return n
    raise RuntimeError("no free X display number")


class CDP:
    """The few DevTools protocol calls a scenario needs, over one page's WebSocket."""

    def __init__(self, ws_url: str) -> None:
        from websockets.sync.client import connect

        self._conn = connect(ws_url, max_size=None, open_timeout=10)
        self.ws = self._conn.__enter__()
        self.n = 0
        self.lock = threading.Lock()

    def call(self, method: str, **params: Any) -> dict[str, Any]:
        with self.lock:
            self.n += 1
            mid = self.n
            self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
            while True:  # events arrive only for domains you enable: enable none you won't drain
                msg = json.loads(self.ws.recv(timeout=60))
                if msg.get("id") == mid:
                    if "error" in msg:
                        raise RuntimeError(f"{method}: {msg['error']}")
                    return msg.get("result", {})

    def close(self) -> None:
        try:
            self._conn.__exit__(None, None, None)
        except Exception:
            pass


class Timeline:
    """Marks with wall-clock times (the recordings' own clock), one JSON object per line."""

    def __init__(self, path: Path) -> None:
        self.f = open(path, "a")
        self.lock = threading.Lock()

    def write(self, rec: dict[str, Any]) -> None:
        with self.lock:
            if not self.f.closed:
                self.f.write(json.dumps({"t": round(time.time(), 3), **rec}) + "\n")
                self.f.flush()

    def mark(self, what: str, **extra: Any) -> None:
        self.write({"kind": "mark", "what": what, **extra})

    def close(self) -> None:
        with self.lock:
            self.f.close()


class Window:
    """One Chrome app window on its own virtual display, driven over CDP. Boxes are
    [left, top, right, bottom] in CSS pixels, as getBoundingClientRect gives them."""

    def __init__(self, take: "Take", name: str, display: int, css: tuple[int, int], scale: float, cdp: CDP) -> None:
        self.take, self.name, self.display, self.css, self.scale, self.cdp = take, name, display, css, scale, cdp

    @property
    def px(self) -> tuple[int, int]:
        return int(self.css[0] * self.scale), int(self.css[1] * self.scale)

    # ------------------------------------------------------------------ the page
    def eval(self, expr: str) -> Any:
        """A JavaScript expression's value (promises are awaited)."""
        r = self.cdp.call("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            raise RuntimeError(f"JS error in {self.name}: {d.get('exception', {}).get('description') or d.get('text')}")
        return r.get("result", {}).get("value")

    def goto(self, url: str, timeout: float = 30) -> None:
        self.cdp.call("Page.navigate", url=url)
        time.sleep(0.3)
        wait(lambda: self.eval("document.readyState") == "complete", timeout, f"{url} to load")

    def reload(self, timeout: float = 30) -> None:
        self.cdp.call("Page.reload")
        time.sleep(0.3)
        wait(lambda: self.eval("document.readyState") == "complete", timeout, "the reload")

    def _q(self, selector: str) -> str:
        return f"document.querySelector({json.dumps(selector)})"

    def visible(self, selector: str) -> bool:
        return bool(self.eval(f"(() => {{ const e = {self._q(selector)};"
                              " return !!e && !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length); })()"))

    def wait_for(self, selector: str, timeout: float = 20) -> None:
        """Until an element matching selector is on the page and visible."""
        wait(lambda: self.visible(selector), timeout, f"{selector} in {self.name}")

    def text(self, selector: str) -> str:
        return self.eval(f"(() => {{ const e = {self._q(selector)}; return e ? e.textContent.trim() : ''; }})()") or ""

    def wait_for_text(self, selector: str, text: str, timeout: float = 20) -> None:
        wait(lambda: text in self.text(selector), timeout, f"{text!r} in {selector}")

    def box(self, selector: str) -> list[float] | None:
        """The element's box in CSS pixels, or None when it isn't there."""
        return self.eval(f"(() => {{ const e = {self._q(selector)}; if (!e) return null;"
                         " const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()")

    def boxes(self, selector: str) -> list[dict[str, Any]]:
        """Every match: its text and its box (for example each message in a chat log)."""
        return self.eval(f"[...document.querySelectorAll({json.dumps(selector)})].map(e => {{"
                         " const r = e.getBoundingClientRect();"
                         " return {text: e.textContent.trim(), box: [r.left, r.top, r.right, r.bottom]}; })") or []

    def scroll_to(self, selector: str) -> None:
        self.eval(f"{self._q(selector)}?.scrollIntoView({{block: 'nearest'}})")

    # ------------------------------------------------------------------ the human
    def click(self, selector: str, settle: float = 0.15) -> None:
        """A real mouse click (move, press, release) at the element's centre, so hover, focus
        and pointer handlers fire as they would for a person. The cursor isn't recorded."""
        self.scroll_to(selector)
        b = self.box(selector)
        if not b:
            raise RuntimeError(f"nothing matches {selector} in {self.name}")
        x, y = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        self.cdp.call("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y)
        for typ in ("mousePressed", "mouseReleased"):
            self.cdp.call("Input.dispatchMouseEvent", type=typ, x=x, y=y, button="left", clickCount=1)
        time.sleep(settle)

    def focus(self, selector: str) -> None:
        self.eval(f"{self._q(selector)}?.focus()")

    def type(self, text: str, cps: float = 11, selector: str | None = None) -> None:
        """Type into the focused element (or `selector`) at a person's pace: about 11 characters
        a second reads as typing; never speed typing up in the edit, cut it short instead."""
        if selector:
            self.focus(selector)
        for ch in text:
            self.cdp.call("Input.insertText", text=ch)
            time.sleep(1 / cps)

    def press(self, key: str) -> None:
        """A key press: Enter, Tab, Escape, Backspace, the arrows, Home, End, PageUp, PageDown."""
        code, vk, text = KEYS[key]
        down = dict(type="keyDown", key=key, code=code, windowsVirtualKeyCode=vk, nativeVirtualKeyCode=vk)
        if text:
            down.update(text=text, unmodifiedText=text)
        else:
            down["type"] = "rawKeyDown"
        self.cdp.call("Input.dispatchKeyEvent", **down)
        self.cdp.call("Input.dispatchKeyEvent", type="keyUp", key=key, code=code,
                      windowsVirtualKeyCode=vk, nativeVirtualKeyCode=vk)

    # ------------------------------------------------------------------ the window
    def color_scheme(self, value: str = "dark") -> None:
        """Make the page see prefers-color-scheme: dark (or light), to match the pieces around it."""
        self.cdp.call("Emulation.setEmulatedMedia", features=[{"name": "prefers-color-scheme", "value": value}])

    def screenshot(self, path: Path) -> Path:
        png = self.cdp.call("Page.captureScreenshot", format="png")["data"]
        path.write_bytes(base64.b64decode(png))
        return path

    def cookies(self) -> list[dict[str, Any]]:
        # no Network.enable: its events would fill the socket unread and time it out
        return self.cdp.call("Network.getAllCookies")["cookies"]

    def set_cookies(self, cookies: list[dict[str, Any]]) -> None:
        """Sign a second window in with the first one's session (then reload it). The cookies
        stay in memory: never write a session to disk."""
        keep = ("name", "value", "domain", "path", "secure", "httpOnly", "sameSite", "expires")
        self.cdp.call("Network.setCookies", cookies=[{k: c[k] for k in keep if k in c} for c in cookies])


class Dry(Exception):
    """Raised by Take.ready() in a dry run: the windows are open, screenshots taken, nothing recorded."""


class Take:
    """One recording session: the virtual displays, the windows on them, their recordings and
    the timeline. Use it through run(), which also cleans everything up."""

    def __init__(self, build: Path, fps: int = FPS, dry: bool = False) -> None:
        self.build, self.fps, self.dry = build, fps, dry
        if sys.platform == "darwin":  # Chrome for Mac can't draw on Xvfb: it would open on the real desktop
            sys.exit(f"macOS records in Docker: python3 {Path(__file__).resolve().parent.parent / 'in_docker.py'} "
                     f"uv run {Path(sys.argv[0]).name} {' '.join(sys.argv[1:])}")
        self.chrome = find_chrome() or sys.exit("no Chrome or Chromium on PATH (set CHROME to its path)")
        for tool in ("Xvfb", "ffmpeg"):
            shutil.which(tool) or sys.exit(f"{tool} is not on PATH")
        self.procs: list[subprocess.Popen[bytes]] = []
        self.recs: dict[str, subprocess.Popen[bytes]] = {}
        self.windows: dict[str, Window] = {}
        self.views: dict[str, Any] = {}
        self.started = False
        self.cleanups: list[Callable[[], None]] = []
        self.tl = Timeline(build / ("dry-timeline.jsonl" if dry else "timeline.jsonl"))
        self.clock_steps: list[float] = []
        self._clock_stop = threading.Event()
        threading.Thread(target=self._watch_clock, daemon=True).start()

    def _watch_clock(self) -> None:
        """The marks and the recordings share the wall clock, so a step in it (WSL2 steps it to
        follow Windows) pauses ffmpeg's capture until the clock catches up and can leave the
        marks made meanwhile up to the step's size early. Note every step in the timeline."""
        off = time.time() - time.monotonic()
        while not self._clock_stop.wait(0.1):
            now = time.time() - time.monotonic()
            if abs(now - off) > 0.15:
                self.clock_steps.append(round(now - off, 3))
                self.tl.write({"kind": "clock", "step": round(now - off, 3)})
            off = now

    def spawn(self, argv: list[str], env: dict[str, str] | None = None, log_name: str = "") -> subprocess.Popen[bytes]:
        """A background process in its own session (killed as a group at the end), logging to <log_name>.log."""
        out = open(self.build / f"{log_name}.log", "ab") if log_name else subprocess.DEVNULL
        p = subprocess.Popen(argv, env=env, stdout=out, stderr=out, stdin=subprocess.DEVNULL, start_new_session=True)
        self.procs.append(p)
        return p

    def display(self, w: int, h: int) -> int:
        n = free_display()
        self.spawn(["Xvfb", f":{n}", "-screen", "0", f"{w}x{h}x24", "-nolisten", "tcp", "-nocursor"],
                   log_name=f"xvfb-{n}")
        wait(lambda: x_up(n), 15, f"Xvfb :{n}", step=0.1)
        return n

    def window(self, name: str, url: str, css: tuple[int, int] = (1280, 720), scale: float = 2.0,
               color_scheme: str | None = "dark") -> Window:
        """Chrome on a display of its own, one app window filling it (no tabs, no address bar),
        `css` CSS pixels at `scale` device pixels each. Recorded from take.ready() on (or at
        once, when opened after it)."""
        if name in self.windows:
            raise ValueError(f"a window named {name!r} is already open")
        w, h = css
        n = self.display(int(w * scale), int(h * scale))
        prof = self.build / f"chrome-{name}"
        shutil.rmtree(prof, ignore_errors=True)
        env = {k: v for k, v in os.environ.items() if k != "WAYLAND_DISPLAY"}  # else Chrome may open on your screen
        env.update(DISPLAY=f":{n}", XDG_SESSION_TYPE="x11")
        self.spawn([self.chrome, "--ozone-platform=x11", f"--app={url}", f"--user-data-dir={prof}",
                    "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check",
                    "--disable-extensions", "--hide-scrollbars", "--disable-features=Translate,TranslateUI",
                    "--password-store=basic", "--disable-session-crashed-bubble", "--noerrdialogs",
                    "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
                    "--disable-backgrounding-occluded-windows",
                    f"--force-device-scale-factor={scale}", "--window-position=0,0", f"--window-size={w},{h}"],
                   env=env, log_name=f"chrome-{name}")
        port_file = prof / "DevToolsActivePort"
        port = wait(lambda: port_file.exists() and (port_file.read_text().split() or [None])[0], 30, f"Chrome ({name})")

        def pages() -> list[dict[str, Any]]:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5) as r:
                    return [p for p in json.load(r) if p.get("type") == "page"]
            except OSError:
                return []

        page = wait(pages, 20, f"a page in Chrome ({name})")[0]
        cdp = CDP(page["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        win = Window(self, name, n, css, scale, cdp)
        if color_scheme:
            win.color_scheme(color_scheme)
        wait(lambda: win.eval("document.readyState") == "complete", 30, f"{url} to load")
        self.windows[name] = win
        self.views[name] = {"css": list(css), "scale": scale, "px": list(win.px)}
        if self.started:
            self._record(win)
        return win

    def _record(self, win: Window) -> None:
        """Record a window's display from now on; the file keeps wall-clock timestamps (-copyts)."""
        w, h = win.px
        p = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-y", "-f", "x11grab", "-draw_mouse", "0", "-framerate", str(self.fps),
             "-video_size", f"{w}x{h}", "-thread_queue_size", "1024", "-i", f":{win.display}", "-copyts",
             "-c:v", "libx264", "-preset", "ultrafast", "-crf", str(CRF), "-pix_fmt", "yuv420p",
             str(self.build / f"{win.name}.mkv")],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
            stderr=open(self.build / f"ffmpeg-{win.name}.log", "ab"), start_new_session=True)
        self.recs[win.name] = p

    def write_views(self) -> None:
        (self.build / ("dry-views.json" if self.dry else "views.json")).write_text(json.dumps(self.views, indent=1))

    def ready(self) -> None:
        """The prepared state is on screen: in a dry run, save a screenshot of every window and
        stop (raises Dry); otherwise start recording every window and mark "recording"."""
        self.write_views()
        if self.dry:
            for name, win in self.windows.items():
                win.screenshot(self.build / f"dry-{name}.png")
            raise Dry()
        for win in self.windows.values():
            self._record(win)
        self.started = True
        time.sleep(1.0)  # ffmpeg's first frames, before the first mark
        self.mark("recording")

    def mark(self, what: str, **extra: Any) -> None:
        """A moment the edit can cut to: `what` names it; boxes and any other JSON values ride along."""
        self.tl.mark(what, **extra)

    def stop_recording(self) -> None:
        for p in self.recs.values():
            try:
                assert p.stdin is not None
                p.stdin.write(b"q")  # q, not -t: a -copyts Matroska file cut by -t can come out unreadable
                p.stdin.flush()
            except (BrokenPipeError, OSError):
                pass
        for p in self.recs.values():
            try:
                p.wait(30)
            except subprocess.TimeoutExpired:
                p.kill()

    def close(self) -> None:
        self.stop_recording()
        self._clock_stop.set()
        if self.clock_steps and self.started:
            log(f"warning: the system clock stepped {len(self.clock_steps)} time(s) during the take "
                f"({', '.join(f'{s:+.1f} s' for s in self.clock_steps)}); marks made within that long after a "
                "step can be early. Check those shots in --stills, or record another take.")
        for fn in reversed(self.cleanups):
            try:
                fn()
            except Exception as e:  # noqa: BLE001 - cleanup must go on
                log("cleanup:", e)
        for win in self.windows.values():
            win.cdp.close()
        self.write_views()
        self.tl.close()
        for p in reversed(self.procs):
            if p.poll() is None:
                try:
                    os.killpg(p.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        for p in self.procs:
            try:
                p.wait(5)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(p.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        for name in self.windows:
            shutil.rmtree(self.build / f"chrome-{name}", ignore_errors=True)


def run(scenario: Callable[[Take], None], description: str | None = None) -> None:
    """The command line for a record.py: --build <take folder> [--dry] [--fps N] [--force]."""
    ap = argparse.ArgumentParser(description=description)
    ap.add_argument("--build", type=Path, required=True,
                    help="the take's folder, for example ~/recordings/<project>/take-1 (not a scratch directory)")
    ap.add_argument("--dry", action="store_true", help="open the windows, screenshot each at take.ready(), stop")
    ap.add_argument("--fps", type=int, default=FPS)
    ap.add_argument("--force", action="store_true", help="record into a folder that already holds a take")
    args = ap.parse_args()
    build = args.build.expanduser().resolve()
    build.mkdir(parents=True, exist_ok=True)
    if not args.dry and (build / "timeline.jsonl").exists() and not args.force:
        sys.exit(f"{build} already holds a take; record into a new folder (take-2, take-3, …) or pass --force")
    if not args.dry and args.force:
        for old in [*build.glob("*.mkv"), build / "timeline.jsonl", build / "views.json"]:
            old.unlink(missing_ok=True)
    if str(build).startswith(("/tmp/", "/var/tmp/")) and not args.dry:
        log(f"note: {build} is under a temporary folder; keep takes you mean to use in ~/recordings/<project>/")
    take = Take(build, args.fps, args.dry)

    def on_term(*_: Any) -> None:
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, on_term)
    try:
        scenario(take)
    except Dry:
        log("dry run: windows opened, screenshots in", build, "(dry-*.png)")
        return
    finally:
        take.close()
    log("recorded:", build)
    log("next: watch it (edit.py --build", str(build), "--stills), then write captions.json in that folder")
