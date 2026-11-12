"""Terminals recorded as real video.

Each terminal is a tmux session on a private tmux server (never yours). termview.py streams a
read-only `tmux attach -r` of it into xterm.js (termview.html), shown in its own Chrome window on
its own virtual display, so a terminal is recorded as video like any other window, never rebuilt
from text. Nothing typed in that window reaches the shell: the scenario types through tmux.

Every change to a pane's text also goes to the timeline (kind "term"), and a new line that
matches a watched pattern becomes a "work" mark, for the edit to cut to:

    terms = Terminals(take)
    term = terms.open("shell", title="you@laptop", subtitle="bash")
    terms.watch("shell", r"^\\$ (make|pytest)")
    take.ready()
    terms.type("shell", "make test")
    terms.wait_for("shell", r"passed|failed", timeout=120)
"""

from __future__ import annotations

import os
import re
import shlex
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
from pathlib import Path
from typing import Any

from .record import Take, Window, wait

HERE = Path(__file__).resolve().parent.parent  # the scripts folder: termview.py and termview.html


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Tmux:
    """A private tmux server (tmux -L <name>): its sessions are the recorded terminals."""

    def __init__(self, name: str) -> None:
        self.sock = name
        self.tmux = shutil.which("tmux") or sys.exit("tmux is not on PATH (needed to record terminals)")

    def run(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run([self.tmux, "-L", self.sock, *args], capture_output=True, text=True)

    def new_session(self, name: str, cwd: str, env: dict[str, str], argv: list[str], width: int, height: int) -> None:
        # the pane runs under exactly this environment (env -i): nothing of yours leaks in by accident
        cmd = ["env", "-i", *[f"{k}={v}" for k, v in env.items()], *argv]
        r = self.run("new-session", "-d", "-s", name, "-x", str(width), "-y", str(height), "-c", cwd, shlex.join(cmd))
        if r.returncode != 0:
            raise RuntimeError(f"tmux new-session failed: {r.stderr.strip()}")

    def send_text(self, name: str, text: str) -> None:
        # tmux reads a ";" argument as its own command separator and sends nothing, -l or not,
        # so semicolons go over as hex
        for i, part in enumerate(text.split(";")):
            if i:
                self.run("send-keys", "-t", name, "-H", "3b")
            if part:
                self.run("send-keys", "-t", name, "-l", part)

    def key(self, name: str, key: str) -> None:
        self.run("send-keys", "-t", name, key)

    def capture(self, name: str) -> str:
        return self.run("capture-pane", "-p", "-t", name).stdout

    def history(self, name: str) -> list[str]:
        """Every line the pane has shown, oldest first: scrolled-off lines included, wrapped lines
        joined, blank rows below the last line dropped."""
        lines = self.run("capture-pane", "-p", "-J", "-S", "-", "-t", name).stdout.split("\n")
        while lines and not lines[-1].strip():
            lines.pop()
        return lines

    def kill_server(self) -> None:
        self.run("kill-server")


class Terminals:
    """The take's terminals: tmux panes, the viewer that streams them, and their windows."""

    def __init__(self, take: Take, cols: int = 100, rows: int = 28) -> None:
        self.take, self.cols, self.rows = take, cols, rows
        self.tmux = Tmux(f"demo-video-{os.getpid()}")
        self.port = free_port()
        take.spawn([sys.executable, str(HERE / "termview.py"), self.tmux.sock, str(self.port)], log_name="termview")
        wait(self._viewer_up, 15, "the terminal viewer")
        self.panes: list[str] = []
        self.last: dict[str, list[str]] = {}
        self.watches: dict[str, list[re.Pattern[str]]] = {}
        self.cells: dict[str, Any] = {}
        self.typed: dict[str, str] = {}
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._poll, daemon=True)
        self.thread.start()
        take.cleanups.append(self.close)

    def _viewer_up(self) -> bool:
        try:
            with socket.create_connection(("127.0.0.1", self.port), timeout=0.5):
                return True
        except OSError:
            return False

    def open(self, name: str, title: str = "", subtitle: str = "", badge: str = "", color: str = "#6aa8ff",
             argv: list[str] | None = None, cwd: str | None = None, env: dict[str, str] | None = None,
             css: tuple[int, int] = (1280, 720), scale: float = 1.5, prompt: str | None = None) -> Window:
        """A shell (or `argv`) in a new pane, and its window. `env` is the whole environment the
        pane gets (a clean default if None): give it a throwaway HOME, never your real one, when
        the command writes config. `title`, `subtitle`, `badge` and `color` dress the window's
        title bar (for example the agent's name and its colour). `prompt` is a regular expression
        the last line matches once `argv` is ready for input (a Python REPL: r">>> ?$")."""
        home = cwd or os.getcwd()
        base_env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": home, "TERM": "xterm-256color",
                    "COLORTERM": "truecolor", "LANG": "C.UTF-8", "PS1": "$ "}
        pane_env = dict(base_env, **(env or {}))
        rc = self.take.build / f"{name}-rc.sh"
        # no history file: HOME is often the demo checkout
        rc.write_text(f"PS1={shlex.quote(pane_env.get('PS1', '$ '))}\nHISTFILE=/dev/null\n")
        cmd = argv or ["bash", "--noprofile", "--rcfile", str(rc), "-i"]
        self.tmux.new_session(name, home, pane_env, cmd, self.cols, self.rows)
        # no status line; viewers attach at the pane's size, so it never changes
        # (a global window-size=manual crashed tmux 3.6 at the next new-session)
        self.tmux.run("set-option", "-g", "status", "off")
        self.tmux.run("set-option", "-ga", "terminal-overrides", ",xterm-256color:Tc")
        self.panes.append(name)
        ready = r"\$$" if argv is None else prompt
        if ready:
            rx = re.compile(ready)
            wait(lambda: rx.search(self.screen(name).rstrip()), 10, f"the {name} prompt")
            self.tmux.key(name, "C-l")
            time.sleep(0.3)
        q = urllib.parse.urlencode({"name": name, "cols": self.cols, "rows": self.rows, "port": self.port,
                                    "title": title or name, "sub": subtitle, "badge": badge, "color": color})
        win = self.take.window(name, (HERE / "termview.html").as_uri() + "?" + q, css, scale, color_scheme=None)
        self.cells[name] = wait(lambda: win.eval("window.__cell || null"), 30, f"the {name} view")
        self.take.views.setdefault("cells", {})[name] = self.cells[name]
        self.take.views["terminal"] = {"cols": self.cols, "rows": self.rows}
        return win

    def screen(self, name: str) -> str:
        return self.tmux.capture(name)

    def type(self, name: str, text: str, cps: float = 22, enter: bool = True) -> None:
        """Type a command at a person's pace (commands read faster than prose: ~22 a second).
        The line goes to the timeline (kind "typed"), for the edit's out/commands.txt."""
        self.typed[name] = text
        self.take.tl.write({"kind": "typed", "pane": name, "text": text})
        for ch in text:
            self.tmux.send_text(name, ch)
            time.sleep(1 / cps)
        if enter:
            time.sleep(0.35)
            self.tmux.key(name, "Enter")
            if re.match(r"(async\s+)?(for|while|with|if|try|def|class)\b", text):
                # a one-line compound statement leaves a Python REPL on its "..." prompt: an empty
                # line runs it (a shell has run it already and shows no "...")
                time.sleep(0.4)
                lines = self.tmux.history(name)
                if lines and lines[-1].strip() == "...":
                    self.tmux.key(name, "Enter")

    def key(self, name: str, key: str) -> None:
        """A tmux key name: Enter, Escape, Up, Down, C-c, …"""
        self.tmux.key(name, key)

    def wait_for(self, name: str, pattern: str, timeout: float = 60) -> re.Match[str]:
        """Wait for a regular expression in what the pane printed from the last typed command on
        (everything, if nothing was typed): lines that scrolled off count, wrapped lines are joined."""
        rx = re.compile(pattern, re.M)
        return wait(lambda: rx.search(self.since_typed(name)), timeout, f"/{pattern}/ in {name}", step=0.3)

    def since_typed(self, name: str) -> str:
        """The pane's text from the line holding the last typed command to the end."""
        lines = self.tmux.history(name)
        typed = self.typed.get(name)
        if typed:
            for i in range(len(lines) - 1, -1, -1):
                if typed in lines[i]:
                    return "\n".join(lines[i:])
        return "\n".join(lines)

    def watch(self, name: str, pattern: str) -> None:
        """Mark "work" (with pane, row and line) whenever a new line in `name` matches `pattern`."""
        self.watches.setdefault(name, []).append(re.compile(pattern))

    def _poll(self) -> None:
        while not self.stop.is_set():
            for pane in list(self.panes):
                r = self.tmux.run("capture-pane", "-p", "-t", pane)
                if r.returncode != 0:
                    continue
                lines = r.stdout.split("\n")
                old = self.last.get(pane)
                if old != lines:
                    self.take.tl.write({"kind": "term", "pane": pane, "text": r.stdout})
                    if old is not None:
                        before = set(old)
                        for row, ln in enumerate(lines):
                            if ln not in before and any(rx.search(ln) for rx in self.watches.get(pane, [])):
                                self.take.mark("work", pane=pane, row=row, line=ln.strip())
                    self.last[pane] = lines
            time.sleep(0.2)

    def close(self) -> None:
        self.stop.set()
        self.thread.join(5)
        self.tmux.kill_server()
