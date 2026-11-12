# How good open-source READMEs demo their tool (survey, September 2026)

A survey of the demo media in 20-odd developer-tool READMEs, done by an AI research agent in September 2026. READMEs were pulled with `gh api`; each asset was measured with ffprobe and Pillow and sampled at 0–3 s. "@N px" is the width the README displays it at; the README column measured 838 px wide at a 1440 px viewport. Numbers are as measured then; repositories change their media, so check before you cite one.

**Bottom line:** great README demos are short, captioned GIFs of the app already running. Almost none have sound: GitHub plays README videos muted.

| Example | First ~3 s, then the rest | Format, length, size | Legibility, sound, captions | How it was made, and verdict |
|---|---|---|---|---|
| [Superset](https://github.com/superset-sh/superset) | Home screen; the caption **"Describe the task"** appears at 0.8 s as a prompt types. Then 8 captioned beats: agents in split panes, monitoring, CLI, swarm, diff review, line comment → agent | GIF 1280×873, 29 s, 9.5 MB, 8 fps @800 px, plus feature GIFs in `<details>` | UI text unreadable on purpose; captions (~24 px on screen) carry the story. Silent | Browser screen captures + VHS + ffmpeg, per a written SOP: "Every frame is real app state… No mockups." **Best model** |
| [claude-squad](https://github.com/smtg-ai/claude-squad) | A static screenshot comes first. The video opens on 4 live sessions, zooms to "Enter prompt: fix…" by ~2 s, then GitHub issue → agent → diff → PR | Inline MP4 1316×1080, 33 s, 6.8 MB | Camera zooms make the terminal readable. No audio track | Screen Studio-style zoom and wallpaper (tool not documented). Many agents plus one task end to end |
| [Claude Code](https://github.com/anthropics/claude-code) | Prompt "audit and improve test coverage" already typed; ⇥ and ↵ keystroke badges by ~2 s, then tool calls scroll | GIF 1552×992, 42 s, 11 MB @838 px | Zoomed terminal in a window frame. Silent | Screen Studio-style (not documented). Clear opening, long monotonous middle |
| [Crush](https://github.com/charmbracelet/crush) | Starts mid-session on "Thinking…"; permission dialog with a diff at 1.5 s, then command palette and model switcher | GIF 1600×900, 6 s, 8.6 MB @800 px | Text can't be read. Silent | Not documented. Sells the look, not the function |
| [browser-use](https://github.com/browser-use/browser-use) | One-sentence task above the GIF. At 0.8 s the camera zooms onto "Can you book me my practical drivers license…" → site → CAPTCHA → confirmation | GIF 960×540, 20 s, 8.1 MB | Huge zoomed prompt. Silent | Screen Studio-style. Task to payoff in 20 s |
| [MagenticLite](https://github.com/microsoft/magentic-ui) | 4 task videos in `<details>`, first one open; opens on a title card, "Fill Expense Forms" | MP4 960×960, 76–78 s, ~9.4 MB each | Zooms. No audio track | Good menu of tasks, too long for a hero |
| [container-use](https://github.com/dagger/container-use) | 0–3 s is a `claude "Create 2 variations…` command typed into an empty terminal; then the whole run in real time | GIF 848×470, 104 s, 1.7 MB @700 px | Small text, no cuts or captions | Honest but slow |
| [mcp_agent_mail](https://github.com/Dicklesworthstone/mcp_agent_mail) | Captioned stills: "Unified Inbox — threads and acknowledgements", "Advisory File Reservations…" | GIF of 7 stills × 3.5 s, 3.2 MB; links a 23-min video | Captions readable, screenshots not | Explains agents mailing each other, never shows it happening |
| [agentchattr](https://github.com/bcurts/agentchattr) | Static chat screenshot of three agents bickering over a broken login; later a GIF of the agents in hats they designed | PNG 1410×1420; GIF 10 s, 2 MB | Chat text tiny at 838 px | Personality lands, the "live" part doesn't |
| [aider](https://github.com/Aider-AI/aider) | `aider demo.py` → "add a name param to the `greeting` function" → edit and commit | Animated SVG: 80×32 terminal at 14 px, 15.5 s loop, 118 KB | Vector text stays sharp. Longer recordings add timed caption pop-ups and text-to-speech narration | termtosvg, asciinema, and a TTS script. Sharpest, smallest demo here |
| [VHS](https://github.com/charmbracelet/vhs) / [gum](https://github.com/charmbracelet/gum) | `neofetch` → "Welcome to VHS!…"; gum: `./demo.sh` → "Hello, there! Welcome to Gum." → types a name | GIFs of 8.6 s (0.14 MB) and 30 s (0.18 MB), plus one GIF per gum subcommand | gum's `FontSize 22` at 800 px comes out ~16 px @600 px | VHS scripts ("tapes") committed to the repo, using `Hide`/`Show`, `Wait /regex/`, `LoopOffset`. Reproducible, tiny, playful |
| [lazygit](https://github.com/jesseduffield/lazygit) | App already open; captions in the bottom row: "Stage a file" → "Commit our changes Pressing \<tab\>" → "Push to the remote Pressing P" | 15 per-feature GIFs, e.g. 14 s and 0.47 MB, kept on an `assets` branch | Captions drawn inside the UI. Silent | Scripted integration tests + terminalizer + gifsicle. Regenerated from code |
| [gh-dash](https://github.com/dlvhdr/gh-dash) | Dashboard already loaded (startup hidden), then PRs, a diff, a comment "Looks good to me! 🚀" | GIF 1600×800, 12 s, 2.4 MB | `FontSize 24` comes out ~12.6 px on screen | A VHS tape with `Hide`/`Show` and `PlaybackSpeed 1.3` to cut dead time |
| [starship](https://github.com/starship/starship) / [atuin](https://github.com/atuinsh/atuin) / [zoxide](https://github.com/ajeetdsouza/zoxide) | starship: red/green prompt at 0 s; atuin: search UI by ~2 s; zoxide narrates itself through typed `# comments` | 38 s, 12 s and 41 s GIFs, 0.4–2.5 MB | starship's huge font reads well; zoxide's 1920 px canvas shrinks its text to 44% | Screen captures, tool not documented; the older ones still work years later |
| [zellij](https://github.com/zellij-org/zellij) / [yazi](https://github.com/sxyazi/yazi) | zellij: dense multi-pane choreography; yazi: feature titles along the bottom ("Scrollable Preview") | GIF 68 s, 4.8 MB; MP4 57 s, 10 MB, **with an audio track** | zellij's text can't be read; yazi's captions carry it | Too long for a loop |
| Product sites | [ollama.com](https://ollama.com) (43 s) and [openwebui.com](https://openwebui.com) (8 s) use autoplaying, muted, looping MP4s. [zed.dev](https://zed.dev): static hero, an opt-in "Watch Demo" with sound, silent 15–25 s clips | | | Narration only appears where the viewer chooses to start it |

**Static image only:** [fzf](https://github.com/junegunn/fzf), [btop](https://github.com/aristocratos/btop), [k9s](https://github.com/derailed/k9s), [tldraw](https://github.com/tldraw/tldraw), [Warp](https://github.com/warpdotdev/warp), [vibe-kanban](https://github.com/BloopAI/vibe-kanban), [OpenHands](https://github.com/OpenHands/OpenHands), [AutoGen](https://github.com/microsoft/autogen).

**No demo media:** [Zed](https://github.com/zed-industries/zed), [Cline](https://github.com/cline/cline).

## Patterns

- **Length:** the median of the 20 hero demos measured is 26 s, and the strongest loops run 6–30 s. Everything over 60 s reads as a raw recording.
- **Opening:**
  - Nobody shows installation. The app is already running with prepared state: gh-dash hides startup, lazygit seeds a repo, Superset stages a demo org.
  - The task is stated within 1–2 s.
  - Frame 1 has to work as a thumbnail. GitHub [shows GIFs paused](https://github.blog/changelog/2022-05-18-option-to-prevent-animated-images-from-playing-automatically/) to viewers who turn on reduced motion. VHS's `LoopOffset` exists to make the first frame "more interesting" ([docs](https://github.com/charmbracelet/vhs#set-loop-offset)).
- **Cuts vs. one take:**
  - A single task gets one continuous take (Claude Code, aider).
  - A story with several features uses ~3.5 s captioned beats joined by 0.4 s crossfades (Superset).
  - Parallel work is shown through the app's own split view (Superset's panes, claude-squad's list + preview), not a collage of windows.
- **Text size:**
  - A 1600 px source is shown at about half size in the README column.
  - Winners render big (VHS `FontSize` 22–46, starship), zoom the camera (claude-squad, browser-use), or accept unreadable UI and put the message in large captions (Superset).
  - Superset re-shot its feature images because full-window captures showed each feature as "a tiny sliver of the frame".
- **Captions:** 3–8 words, verb first ("Monitor every agent from one place"). Variants include captions drawn in the UI (lazygit), titles along the bottom (yazi), keystroke badges (Claude Code) and typed comments (zoxide).
- **Sound:**
  - GitHub renders README videos as `<video controls muted>`: no autoplay, no loop, 640 px maximum height.
  - Most README MP4s checked have no audio track at all.
  - Narration only appears in long-form video the viewer chooses to start.
- **Loop and format:** every GIF measured loops forever; README MP4s must be clicked. So the hero should be a GIF or animated SVG, with an MP4 kept for optional depth.
- **File size:**
  - GitHub caps uploaded GIFs at 10 MB, and videos at 10 MB on free plans ([docs](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)).
  - Superset fits 29 s under that at 1280 px, 8 fps and 192 colours.
  - A GIF committed to the repo can be bigger (Claude Code's 11 MB one renders) but loads slowly.
  - VHS terminal GIFs are 34–540 KB.
- **Placement and count:** one hero right under the one-line pitch, before install. Per-feature clips go lower or inside `<details>` (lazygit 15, Superset 5, MagenticLite 4). Long-form video is linked, not embedded.
- **Maintenance:** the best-kept demos are generated from code (VHS tapes, lazygit's demo tests, Superset's SOP), so they get re-shot when the UI changes.

## Best models for showing agents (or people) working together

1. **Superset's hero film:** 6–8 captioned beats from real sessions, ~30 s, under 10 MB, with a documented pipeline.
2. **claude-squad:** lead with a still of every agent at once, then use zooms that make one exchange readable.
3. **lazygit + VHS:** scripted, repeatable per-feature GIFs with captions in the frame, terminals rendered at `FontSize` 22 or more.
4. **agentchattr:** make the conversation the hero and give the agents personality, then add what it lacks: motion, with messages arriving live and one agent citing another's work.
5. **browser-use:** one sentence naming the task, above a ~20 s GIF that zooms onto the prompt so the first frames are readable.
