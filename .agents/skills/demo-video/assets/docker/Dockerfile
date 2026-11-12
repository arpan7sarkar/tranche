# The kit's Linux toolchain, for recording on macOS through Docker Desktop. scripts/in_docker.py
# builds it (tagged demo-video-kit) and runs commands in it; see references/recording.md, "On macOS".
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb ffmpeg chromium tmux fonts-noto-core fontconfig python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.7.13 /uv /usr/local/bin/uv
# /cache is a named volume, so uv's packages and Pythons, fontconfig's cache and the Kokoro venv
# survive between runs. HOME is the Mac's (in_docker.py sets it, so ~ means the same path inside)
# and holds only mount points, so everything that writes under HOME is pointed here instead.
RUN useradd -m rec && mkdir /cache && chown rec /cache
USER rec
ENV CHROME=/usr/bin/chromium \
    XDG_CACHE_HOME=/cache XDG_DATA_HOME=/cache/share XDG_CONFIG_HOME=/cache/config \
    UV_CACHE_DIR=/cache/uv UV_PYTHON_INSTALL_DIR=/cache/python KOKORO_VENV=/cache/kokoro
