---
name: demo-video
description: Make a short product demo video (a README GIF, a launch or walkthrough MP4) from a real screen recording of a web app or terminal. Records on virtual displays, cuts by timeline marks, adds captions, a local voice-over and a music bed, and gets the sound approved before rendering. Use when asked for a demo video, walkthrough, screencast, README GIF or launch clip.
---

# Demo video

Make a demo video the way that has held up on real videos: real footage, a short story, captions of six words or fewer, narration in passages, a steady music bed, and the sound approved before the video is rendered.

Paths below are relative to this skill's folder: the tools are in `scripts/`, the starting rig in `assets/template/`, details in `references/`. Read `references/lessons.md` once before your first video: every rule below has a reason there.

## Rules

1. **Real screen video only.** Never stitch screenshots, redraw or mock the UI, or put data on screen that the app didn't produce.
2. **No setup on camera.** The app is already running, signed in, with its data loaded. Use a demo account and made-up data; nothing private on screen.
3. **Captions of six words or fewer, one per beat.** Narration, if any, in passages that span several beats, never one line per caption.
4. **Music, if any:** one steady level about 7 dB under the voice (-23 / -16 LUFS), no ducking, a lead-in of music alone, the first line on a pause in the track, and the track's credit line on the end card.
5. **Approve audio as audio.** Render the sound alone, send it to the person, and wait for their yes before rendering the video. `edit.py` enforces this: it renders narration or music only with `--audio-approved`, and refuses again if the sound changed since.
6. **Under 10 MB per file.** The README GIF is silent and its first frame tells the story.
7. **Takes in `~/recordings/<project>/`**, never in a session scratch directory (it gets wiped) and never in git. The rig lives in the kit's `projects/<project>/`.
8. **Deliver the files, not the tooling.** Don't add the recorder or editor to the product's repository, and don't upload or post anything on your own.

## Steps

### 1. Check the machine

```bash
python3 scripts/check_env.py --deep
```

Linux (or WSL2) with Xvfb, ffmpeg with libx264, Chrome or Chromium, and uv; tmux to record terminals; the Kokoro venv for a voice (the `voice-over` skill sets it up). Fix every MISSING row before going on. On macOS, run every command that records or edits (this check included) through `scripts/in_docker.py`, which needs Docker Desktop: see `references/recording.md`, "On macOS".

### 2. The brief

Ask the person, in one message, and don't build until you have answers:

- What is it for: a README GIF, a longer MP4, or both? Who watches it?
- What does the product do that nothing else does? That moment is the story.
- What should be on screen, and what should the viewer believe afterwards?
- One or two videos they like, as references.
- Narration or captions only? Which voice (audition with the `voice-over` skill)? Which music track, and its licence and credit line, or an original bed from `scripts/chiptune.py` in a style they pick?

Then propose a beat list (6–10 beats, 20–45 s: cold open on the payoff, the one input, the work, the payoff, the end card) and agree it.

### 3. The rig

```bash
python3 scripts/new_project.py <kit>/projects/<name> --url http://localhost:3000 --name "<Product>"
```

This copies `record.py` (the scenario), `edit.py` (the cut) and `captions.json`, with the kit's path filled in. Without `--url` it records a bundled sample app: run the whole pipeline on that first if this machine hasn't made a video before.

Write the scenario in `record.py`: open the windows, reach the prepared state, call `take.ready()`, then play the human (click, type at reading pace) and `take.mark()` every moment the cut needs, with the box to frame it by. The API, terminals and second windows: `references/recording.md`.

### 4. Dry run, then takes

```bash
uv run record.py --build ~/recordings/<name>/take-1 --dry
uv run record.py --build ~/recordings/<name>/take-1
```

The dry run stops at `take.ready()` and saves `dry-<window>.png`: check the text is legible at 830 px wide, the colour scheme matches, and nothing private shows. Then record. Live software differs every run: expect several takes (`take-2`, `take-3`), and keep the one whose story is best.

### 5. The cut, previewed

Write `shots()` in `edit.py` from the marks: the splash, a cold open on the finished state, the beats as they happened (typing at its real pace, cut short; waits sped up, and the badge says so), the finished state again, the end card. Then:

```bash
uv run edit.py --build ~/recordings/<name>/take-1 --stills
```

Look at every frame in `out/stills/`. Write the take's `captions.json` now, after watching it: a caption per shot key and the narration passages (format: `references/editing.md`). Repeat until the stills tell the story.

### 6. The sound, for approval (a gate)

```bash
uv run <skill>/scripts/audio_check.py pauses <track>     # the track's deepest early pauses, for --lead-in
uv run edit.py --build <take> --audio-only --voice bm_george --music <track> --music-start 0 --lead-in 4.0
```

This writes `out/mix.wav`, `out/narration.wav` and `out/music.wav` and prints their loudness (the voice should sit about 7 dB over the music). Send the three files to the person and **stop until they approve**. If they want changes, change the passages, voice or levels and run it again.

### 7. Render

```bash
uv run edit.py --build <take> --voice bm_george --music <track> --music-start 0 --lead-in 4.0 --audio-approved --gif
```

That is the approved `--audio-only` run's exact options, without `--audio-only`, plus `--audio-approved` (and `--gif` for the README GIF). Pass `--audio-approved` only after the person said yes to that mix. It writes `out/<name>.mp4` and `out/<name>.gif` and warns above 10 MB. Watch the MP4 once with sound before handing it over.

### 8. Deliver

Hand over the files and the music's credit line, and say where the raw take is. README placement, GitHub upload and size fixes: `references/delivery.md`.

## When something goes wrong

`references/troubleshooting.md`. The research behind the rules: `references/research-demo-videos.md` and `references/research-readme-survey.md`.
