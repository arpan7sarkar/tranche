# Troubleshooting

Run `python3 scripts/check_env.py --deep` first: it records one second of Chrome on a virtual display, the whole rig in miniature.

| Symptom | Cause and fix |
|---|---|
| `timed out waiting for Xvfb :N` | Xvfb didn't start: read `xvfb-N.log` in the take. A stale `/tmp/.XN-lock` from a crashed run is skipped automatically; a stray Xvfb can be stopped with `pkill -f "Xvfb :N"`. |
| Xvfb runs but `/tmp/.X11-unix/XN` never appears (WSL2) | WSLg owns that folder. Xvfb still listens on the abstract socket, which the kit checks; nothing to fix. |
| Chrome opened on your real screen | A Wayland session: the kit unsets `WAYLAND_DISPLAY` and passes `--ozone-platform=x11`; if you launch Chrome yourself, do the same. |
| `timed out waiting for Chrome (name)` | Read `chrome-<name>.log`. `No usable sandbox` inside a container: Docker's default seccomp profile blocks the user namespaces Chrome's sandbox needs, so run the container with `--security-opt seccomp=unconfined` (`in_docker.py` does). Don't add `--no-sandbox`: Chrome then draws a warning bar into every recorded frame. |
| `macOS records in Docker` (from `check_env.py` or `record.py`) | A Mac can't run the recorder directly. Put `scripts/in_docker.py` in front of the command (Docker Desktop): see `recording.md`, "On macOS". |
| In Docker, the app on `localhost` doesn't load | The container's `localhost` is its own. An app running on the Mac is at `host.docker.internal` (port unchanged). |
| In Docker, a terminal take says `command not found` | The commands run inside the container. Build an image `FROM demo-video-kit` that installs them and run with `DEMO_VIDEO_IMAGE` set to it. |
| `in_docker: … isn't visible inside the container` | Only the skills folder, the current folder and `~/recordings` are mounted. Run from the rig's folder and keep takes in `~/recordings/<project>/`. On a Mac `/tmp` is a link to `/private/tmp`, so use the `/private/tmp` path. |
| A recording won't open, or `Duplicate element` / `EBML` errors | It was stopped with `-t` or killed. The kit stops ffmpeg by sending `q`, which finalises the file; don't kill takes with `kill -9`. |
| The recorder warns the clock stepped | WSL2 follows Windows' clock in jumps. ffmpeg pauses capture until the clock catches up, and marks made meanwhile land early by up to the step. Check the shots near it in `--stills`; record another take if one is off. |
| Captions in a box font or squares | No Noto or DejaVu fonts: install `fonts-noto-core` (or `fonts-dejavu-core`). |
| The terminal window stays blank | It loads xterm.js and fonts from cdn.jsdelivr.net and Google Fonts: the machine needs network while recording. Read `termview.log` too. |
| tmux crashed at `new-session` | A global `window-size manual` setting crashed tmux 3.6; the kit doesn't set it. Check your `~/.tmux.conf` isn't loaded (the kit uses a private server). |
| `Kokoro failed` with `Error processing file '…/phontab'` | espeak-ng (bundled with Kokoro) keeps its data path in a 160-byte buffer. A venv deeper than about 120 characters overflows it. Put the venv somewhere short (`~/.venvs/kokoro`), or point `ESPEAK_DATA_PATH` at a short symlink to its `espeakng_loader/espeak-ng-data`. |
| `Kokoro failed` installing spaCy's model | Kokoro installs `en_core_web_sm` through uv the first time, which needs `VIRTUAL_ENV` set to the venv; the kit sets it. It also needs network once. |
| `pip install kokoro` fails building from source | No PyTorch wheels for your Python: use the Python 3.12 venv the voice-over skill's `setup_kokoro.sh` makes. |
| Semicolons missing from a typed command | tmux takes a `;` argument as its own command separator, even with `send-keys -l`. The kit sends `;` as hex (`send-keys -H 3b`); do the same in your own tmux calls. |
| A Python REPL sits on `...` after a one-line `for` | A compound statement needs an empty line to run. `terms.type` sends it; with your own tmux calls, send one more `Enter`. |
| A container shell's prompt reads `I have no name!@…` | The container runs as your uid, which has no passwd entry there, and the image's bashrc puts `\u` in the prompt. Pipe the command into the shell instead of typing it (`echo 'python3 demo.py' \| docker exec -i <container> bash`), or set `PS1` in an rc file. |
| Output lands out of order, or all at the end | The program's stdout isn't a terminal (`docker run` without `-t`, a pipe), so C programs buffer it. Add `-t`, or run it under `stdbuf -oL`. |
| `no mark 'x'` | The take has no such mark: the error lists the ones it has. Was the take recorded with an older scenario? |
| `The soundtrack changed since the mix that was approved` | Narration text, voice, music, levels or a shot's timing changed after `--audio-only`. Run `--audio-only` again and get the new mix approved. |
| The music is too loud or too quiet | `uv run scripts/audio_check.py levels <take>/out` shows the gap; aim for about 7 dB (`--voice-lufs`, `--music-lufs`). |
| The first spoken line lands on a busy bar | `uv run scripts/audio_check.py pauses track.mp3` lists the track's deepest early pauses; pass one as `--lead-in`. |
| A headless screenshot has a band of whitespace | It was taken with a URL fragment (`#section`), which scrolls before webfonts load. Scroll by measured offsets instead. |
| A second window shows tabs and an address bar | It was opened on `about:blank`. Open it on the app's own origin, copy cookies over CDP, reload. |
| CDP calls time out after a while | A domain was enabled (`Network.enable`) whose events nobody reads; they fill the socket. Don't enable domains you won't drain. |
