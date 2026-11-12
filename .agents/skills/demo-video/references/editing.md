# Editing: shots, captions, narration, sound

`edit.py` turns a take into shots. `demo_video.cut.main(shots)` gives it the command line and does the rest: captions from the take's `captions.json`, stills for review, narration, the soundtrack and its approval gate, and the MP4 and GIF.

```python
from demo_video import cut
from demo_video.cut import Shot, Take

def shots(take: Take) -> list[Shot]:
    typing, sent, end = take.mark("typing"), take.mark("sent"), take.mark("end")
    whole = take.around("app", end["box"], pad=48)
    return [
        cut.title_card("Acme Mail", "Email that answers itself."),
        take.still("app", end["t"], 3.0, whole, key="open"),
        take.clip("app", typing["t"] - 0.4, typing["t"] + 3.0, crop=take.around("app", typing["box"]), key="type", top=True),
        take.clip("app", sent["t"] - 0.5, sent["t"] + 2.0, crop=whole, key="sent"),
        cut.end_card("Acme Mail", "Email that answers itself.", lines=["brew install acme"], url="acme.dev",
                     credit=take.captions.get("credit", "")),
    ]

if __name__ == "__main__":
    cut.main(shots, name="acme")
```

## Shots

Times are wall-clock seconds from the marks (`mark["t"]`). Crops are in the recording's pixels: build them with `full`, `around` and `rows`, not by hand.

| Call | What it gives |
|---|---|
| `take.clip(window, t0, t1, dur=None, crop=None, to=None, key="", top=False)` | The window from `t0` to `t1`. `dur` defaults to real time; a shorter `dur` speeds it up, and the shot carries an "N× speed" badge. `to` moves the camera from `crop` to `to` (`cut.zoom_in(crop, 1.03)` is a slow push-in). |
| `take.still(window, t, dur=3.0, crop=None, to=None, key="")` | One moment, held (the cold open, the final state). |
| `take.split([a, b], t0, t1, dur=None, width=1.0, key="")` | Windows side by side at the same moment: one action reaching two places. `width` keeps each window's left fraction. |
| `take.full(window)` | The whole window. |
| `take.around(window, box, pad=24, min_w=0)` | The smallest 16:9 crop holding a box (CSS pixels, from a mark), at least `min_w` CSS pixels wide so a small element isn't blown up. `cut.union(box1, box2)` frames several. |
| `take.rows(pane, r0, r1, zoom=1.25)` | A terminal window around rows `r0`–`r1`. |
| `take.mark(what, n=0)` / `take.marks(what)` / `take.first(what)` | Marks by name; `take.term_text(pane, t)` is a terminal's text at a moment. |
| `cut.title_card(title, tagline, icon=None, dur=4.0)` | The splash. Frame one of the file: GitHub shows a video paused on it. |
| `cut.end_card(title, tagline, lines=[], url="", credit="", dur=3.6)` | Install lines as shell commands, the URL, the music's credit line. |

A shot's `key` names it in `captions.json`. The video's frames are 1920×1080 at 30 fps; shots cross-fade over 0.25 s, and a caption that changes fades out before the next fades in.

## captions.json

Each take has its own, because each take's story is a little different: the first run copies `captions.json` from beside `edit.py` into the take (or writes a draft from the shot keys). Write the real one after watching the take.

```json
{
 "open": "Email that answers itself",
 "type": "You write one line",
 "sent": "It drafts the rest",
 "credit": "Music: \"Track\" by Artist (example.com), CC BY 4.0",
 "colors": {"You": "#7ece8e", "Acme": "#6aa8ff"},
 "voice": {
  "open": {"text": "This is Acme Mail. You write one line, and it drafts the rest, in your voice.", "through": "sent"},
  "card": "It's open source. The link's on screen."
 }
}
```

- **Captions**: one per shot key, six words or fewer, plain. The render warns about longer ones.
- **`colors`**: words drawn in a colour wherever they appear in a caption (names of people, agents, products).
- **`voice`**: the narration, as passages. Each key is the shot a passage starts on; `through` names the shot it runs to (`"end"` is the last shot). Passages span several beats; a narrator who speaks one line per caption sounds like someone reading captions aloud. Shots under a passage stretch evenly to fit it (`--stills` shows timings before the stretch).
- **`credit`**: the music's credit line, for `end_card(credit=...)`.

## The command line

| Flag | Use |
|---|---|
| `--stills` | One frame per shot (its middle) in `out/stills/`, with the timings. Review framing and captions here before anything slow. |
| `--audio-only --voice bm_george --music track.mp3` | The soundtrack alone: `out/mix.wav`, `out/narration.wav`, `out/music.wav`, and a loudness report. Send these for approval. |
| `--audio-approved` | Required to render a video with narration or music. The render refuses if the soundtrack changed since the `--audio-only` run (narration text, voice, music, levels or shot timings). |
| `--music-start 12.5` | Where in the track to start. |
| `--lead-in 4.0` | Seconds of music alone before the first spoken line. End it on a pause in the track: `uv run scripts/audio_check.py pauses track.mp3` lists the deepest ones. |
| `--voice-lufs -16 --music-lufs -23` | The levels. Keep the gap near 7 dB; the report says where it landed. |
| `--voice-speed 1.0` | Kokoro's speaking speed (1.1–1.15 for a brisk read). |
| `--stems` | Also carry narration and music as extra audio tracks in the MP4. |
| `--gif` / `--gif-only` | The README GIF: silent, loops, 960 px, 12 fps. `make_gif` in `edit.py` chooses its shots (default: the MP4's, without the cards). |
| `--name acme` | The output files' name. |
| `--max-mb 10` | Warn above this size (GitHub's upload limit). |

## Sound rules (and why)

- The voice sits at one static gain (-16 LUFS), the music at one steady level (-23 LUFS) under it, about 7 dB apart. No ducking: dipping the music under each line was tried and rejected.
- The music plays alone for the lead-in, fades in over 0.8 s and out over the last 2.5 s.
- Integrated loudness (EBU R128) ignores the silence between lines, so sparse narration measures right; one-pass `loudnorm` on such a track pumps.
- Bring a track you're allowed to use. Creative Commons Attribution tracks need their credit line on the end card and wherever the video is posted.

## An original music bed

No track you may use? `scripts/chiptune.py` writes an original one, so there's no licence to check and no credit line. It plays 8-bit instruments in a style (`--list` shows them: chiptune, jazz, hiphop, rock, bossa), and with the cut's timings it stops for a bar on each card and lands its ending on the end card:

```bash
uv run edit.py --build <take> --stills                    # also writes out/shots.json
uv run <skill>/scripts/chiptune.py --style jazz --shots <take>/out/shots.json --seed 3 --out <take>/out/music.wav
uv run edit.py --build <take> --audio-only --music <take>/out/music.wav
```

- `--seed` picks the tune: tempo within the style's range, key, progression, drum variant and melody. Use a new seed per video. `--bpm`, `--key` and `--swing` each override one choice and leave the rest of the tune alone.
- A style is data. `--show jazz` prints one as JSON: save it, change what you like (tempo range, keys, progressions in Roman numerals, drum patterns on a 16-step grid, lead rhythms and scale, cadence, sounds, mix) and pass it as `--style-file`. A file with `"base": "jazz"` and only the keys you change works too.
- With narration, shots stretch to fit the passages after `--stills`, so card stops would miss the cards: use `--seconds <length>` for a steady bed instead.
- The approval gate still applies: the generated track is the music in the mix you send for a listen.
