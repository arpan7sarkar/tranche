# Demo video best practices (research notes, September 2026)

A web-research pass on demo videos for developer tools, done by an AI research agent in September 2026. Sources marked "(vendor)" are companies selling demo tools. Check a source before quoting it: links rot and products change. Where these notes and `lessons.md` disagree (music, above all), `lessons.md` wins; it was tested on real takes.

**Bottom line.** The sources agree on one recipe:

- Open on the magic moment within 3 s.
- Show no setup.
- Keep the text readable at the size it's displayed (a README column is about 830 px wide).
- Show cause and effect together (the action and what it triggers) instead of cutting between them.
- Drop the music in a silent README clip, and label any speed-up.

## 1. Principles checklist

- **Length: GIF 8–15 s, hero 20–40 s.**
  - Under 1 minute, 65% of viewers watch to the end ([Vidyard](https://www.vidyard.com/business-video-benchmarks/), 943k videos).
  - A viral agent demo was 23 s, heavily sped up, with "no talking, short and straight to the point" ([a16z speedrun](https://speedrun.substack.com/p/how-to-make-a-viral-launch-video)). Algolia's runs 45 s and Streamlit's 42 s ([markepear](https://www.markepear.dev/examples/video)).
  - GitHub caps GIFs at 10 MB, and videos at 10 MB on free plans ([GitHub Docs](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)). HN readers balk at "an 18 MB GIF of some text" ([HN](https://news.ycombinator.com/item?id=20060794)).
- **Hook within 3 s, no intro.**
  - Open on "the outcome, shown in real UI. No logo intro" ([PH guide](https://screenhance.com/blog/product-hunt-launch-video-guide), vendor).
  - HN's moderator, on Launch HN videos: "Skip any introductions and jump straight into showing your product doing what it does best" ([HN](https://news.ycombinator.com/item?id=43538447)).
  - "The first three steps decide whether a viewer finishes" ([Supademo](https://docs.supademo.com/use-cases/best-practices), vendor).
- **No setup in the hero.**
  - "Skip logins, empty states, and configuration screens" ([Supademo](https://docs.supademo.com/use-cases/best-practices)).
  - Install steps belong in copyable README text. NN/g says to pair text with video because many users won't watch ([NN/g](https://www.nngroup.com/articles/instructional-video-guidelines/)).
  - VHS has a `Hide` command for running commands off camera ([VHS](https://github.com/charmbracelet/vhs)).
- **One idea per clip.** Pick 1–2 "aha" moments; engagement peaks at 7 or fewer steps ([Arcade](https://www.arcade.software/post/whats-inside-an-effortlessly-beautiful-demo), vendor). The top 1% of Arcade demos average 9 steps ([benchmarks](https://www.arcade.software/post/arcade-benchmarks-2024)).
- **Pace to reading speed.**
  - A Launch HN commenter on a chat product's video: "things were moving around so much and so quickly, I couldn't read anything" ([HN](https://news.ycombinator.com/item?id=29396744)).
  - Netflix subtitles allow at most 42 characters per line, 2 lines, and 20 characters per second ([Netflix](https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-USA-Timed-Text-Style-Guide)). So a 60-character message needs at least 3 s on screen.
  - Speed up the waiting, not the reading: "long waits shrink and short steps stay readable" ([agent-proof](https://github.com/askeleven/agent-proof)).
- **Legible at display size.**
  - The README column is at most about 830 px wide ([measured](https://wh0.github.io/2025/05/18/banner-width.html)). A 1920 px frame shown there turns 14 px text into about 6 px.
  - Record at 1280×720 on a 2x (HiDPI) display with enlarged fonts ([egghead](https://howtoegghead.com/instructor/screencasting/screen-setup/)). Crop tightly: "consider whether we need to see your desktop at all" ([Hanselman](https://www.hanselman.com/blog/the-guide-to-creating-quality-technical-screencasts)).
  - Bitmap fonts blur when scaled by fractions ([HN](https://news.ycombinator.com/item?id=39396001)), so scale by exactly 2x or 0.5x.
- **Silent-first for the README.**
  - 75% of people keep their phones muted ([Digiday](https://digiday.com/sponsored/75-percent-of-people-watch-mobile-videos-on-mute/)).
  - HN's moderator: "no fancy logos or background music!" ([HN](https://news.ycombinator.com/item?id=43538447)). Another commenter found a demo's music "surprisingly distracting" ([HN](https://news.ycombinator.com/item?id=39762531)).
  - A preregistered CHI '26 study (477 people) found no consistent effect of background music on engagement or recall ([ACM](https://doi.org/10.1145/3772318.3791466)). Mayer's coherence principle, from learning research, says to cut extraneous material ([Cambridge](https://www.cambridge.org/core/books/abs/cambridge-handbook-of-multimedia-learning/principles-for-reducing-extraneous-processing-in-multimedia-learning-coherence-signaling-redundancy-spatial-contiguity-and-temporal-contiguity-principles/CD5B7AE1279A9AB81F8EEBB53DBEC86E)).
  - A voiceover is fine for a YouTube or Launch HN version (same HN link).
  - In practice (see `lessons.md`): the README GIF stays silent; a longer MP4 can carry narration over a steady, quiet music bed.
- **Polish means legibility, not cinema.** One founder's blunt advice is that nobody cares about a cinematic launch video ([speedrun](https://speedrun.substack.com/p/how-to-make-a-viral-launch-video)).
- **Loop and first frame.**
  - GitHub follows the operating system's reduced-motion setting, so some visitors see a GIF without autoplay ([GitHub Docs](https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-personal-account-on-github/managing-user-account-settings/managing-accessibility-settings)). On Product Hunt, GIFs animate only on hover, so the first frame is the thumbnail ([PH](https://www.producthunt.com/launch/preparing-for-launch)).
  - VHS's `LoopOffset` exists "to make the first frame…more interesting" ([VHS](https://github.com/charmbracelet/vhs)). Hold the last frame 2–3 s; agg defaults to 3 s ([agg](https://docs.asciinema.org/manual/agg/usage/)).
- **One call to action.** "Exactly one CTA" ([Supademo](https://docs.supademo.com/use-cases/best-practices)). Put none in the README GIF, since the README is the call to action. Product Hunt videos shouldn't have one either; the gallery handles it ([PH guide](https://screenhance.com/blog/product-hunt-launch-video-guide)).

## 2. Storyboards

**Hero video, 30 s, silent, with burned-in labels of 6 words or fewer placed next to what they describe:**

| Time | Shot |
|---|---|
| 0–3 s | Cold open on the payoff, zoomed in: the moment only this product produces. Label: the one-line pitch. |
| 3–8 s | Pull back to the whole layout. |
| 8–12 s | The human's one input, typed at normal speed. |
| 12–24 s | The work, sped up with a visible label ("8×") and a running clock; the key moment drops to normal speed and holds for 2 s. Show results (diff stats, test results), not raw logs. |
| 24–28 s | The payoff: it works, and the human reacts. |
| 28–30 s | End card: name, one install line, URL. |

Encode as H.264 ([GitHub Docs](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)). To fit a free-plan upload, a 30 s video must average about 2.6 Mbps or less.

**README GIF, 12 s loop:**

- The one pane that tells the story, captured at 2x and shown at 830 px or less.
- The first frame is already a complete, self-explanatory state.
- 3–4 events arrive, then one human input, then a 2 s hold.
- The end state matches the first frame, so the loop is seamless.
- Keep it under 5 MB. Animated WebP or AVIF also autoplay and loop on GitHub; uploaded MP4s don't ([test repo](https://github.com/george-hawkins/video-in-github-markdown)).

## 3. Production techniques

- **Split the screen instead of cutting.** The magic is often things happening at the same time.
  - Claude Code's agent-team split-pane mode lets you "see everyone's output at once" ([docs](https://code.claude.com/docs/en/agent-teams)). Stoplight's side-by-side format makes differences obvious ([markepear](https://www.markepear.dev/examples/video)).
  - Build it with ffmpeg's `xstack` filter ([ffmpeg](https://ffmpeg.org/ffmpeg-filters.html#xstack)) or an OBS scene layout ([OBS](https://obsproject.com/kb/sources-guide)).
- **Directed zoom and spotlight.**
  - Screen Studio's auto-zoom follows mouse clicks and needs manual zooms where there are none ([guide](https://screen.studio/guide/auto-zoom)). When the action has no clicks (chat, terminals), trigger zooms from event timestamps.
  - Factory's video pipeline uses "directed zoom for small text", spotlight overlays, keystroke overlays, window chrome and side-by-side layouts ([Factory](https://docs.factory.ai/cli/features/droid-control)).
- **Highlight key moments instead of captioning every frame.**
  - Learning research says to cue the essentials and put words next to what they describe ([Cambridge](https://www.cambridge.org/core/books/abs/cambridge-handbook-of-multimedia-learning/principles-for-reducing-extraneous-processing-in-multimedia-learning-coherence-signaling-redundancy-spatial-contiguity-and-temporal-contiguity-principles/CD5B7AE1279A9AB81F8EEBB53DBEC86E)).
  - Give each actor one colour, used everywhere. Kiln found it needed a separate brand guide just for video ([Kiln](https://kiln.tech/blog/we_made_our_launch_video_in_claude_code)).
- **Compress verbose output.**
  - Cursor's homepage reduces agent work to status verbs ("Reading docs", "Generating plan") and diff stats like +135 −21 ([cursor.com](https://cursor.com/)).
  - Devin's "Follow Devin" tab "highlights Devin's actions (file edits, shell commands, etc)" ([Devin docs](https://docs.devin.ai/release-notes/2024)).
- **Speed-ups, labelled.**
  - Use a different speed per step ([agent-proof](https://github.com/askeleven/agent-proof)), and cap idle time while recording with `asciinema rec -i` ([man page](https://www.mankier.com/1/asciinema-record)).
  - "Label a sequence if you speed it up" ([aarena](https://aarena.ai/blog/ai-product-launch-video-guide), vendor). An on-screen timer works well, as in Kinde's ad ([markepear](https://www.markepear.dev/examples/video)).
- **Framing and encoding.**
  - Add padding, a background, a shadow and a window bar ([Screen Studio](https://screen.studio/), [VHS](https://github.com/charmbracelet/vhs)).
  - Make GIFs with [gifski](https://gif.ski/) or ffmpeg's palette filters ([ubitux](https://blog.pkh.me/p/21-high-quality-gif-with-ffmpeg.html)).
  - If you add a voiceover, record it first: "audio leads, video follows" ([Kiln](https://kiln.tech/blog/we_made_our_launch_video_in_claude_code)).

## 4. AI-agent demos: credibility is the product

- **Staging backfires.**
  - Devin's demo drew fire on HN after the chat timestamps showed the task took hours and ran into the next day ([HN](https://news.ycombinator.com/item?id=40008109)). Answer.AI later saw 3 successes in 20 tasks ([Answer.AI](https://www.answer.ai/posts/2025-01-08-devin.html)).
  - Google's footnote "latency has been reduced" didn't stop the headline "Google's best Gemini demo was faked" ([TechCrunch](https://techcrunch.com/2023/12/07/googles-best-gemini-demo-was-faked/)).
- **Real footage is what spreads.**
  - What travels is a recording "unedited enough that the reader believes it" ([doomers](https://doomers.ai/guides/viral-ai-launches), vendor). agent-proof's rule is "One take, start to finish. The only edit is speed" ([agent-proof](https://github.com/askeleven/agent-proof)).
  - So badge the video "real session · 8x", show a clock, and link the raw take.
- **Excitement comes from one implausible moment.**
  - Gibberlink spread on a single beat: two AI agents side by side realising they're both AI ([ElevenLabs](https://elevenlabs.io/blog/what-happens-when-two-ai-voice-assistants-have-a-conversation)).
  - MCP Agent Mail frames its hero GIF as "gmail for your coding agents" ([repo](https://github.com/Dicklesworthstone/mcp_agent_mail)).

## 5. Tools (on Linux)

| Tool | Role | Scriptable | Notes |
|---|---|---|---|
| asciinema + agg | Real terminals | Yes | Re-render later at any font size, theme or speed, with idle time capped ([agg](https://docs.asciinema.org/manual/agg/usage/)). In a README it can only be embedded as an image link ([docs](https://docs.asciinema.org/manual/server/embedding/)). |
| VHS | Scripted, repeatable terminal clips | Yes, and can regenerate in CI ([action](https://github.com/charmbracelet/vhs-action)) | One terminal per script, with a [tmux split example](https://github.com/charmbracelet/vhs/blob/main/examples/split/split.tape). Good for a setup clip, not for live agents. |
| Playwright | Web UI capture | Yes | Set the video size; by default it scales down to fit 800×800 ([docs](https://playwright.dev/docs/videos)). |
| Remotion | Combines clips into MP4 and GIF | Yes | Per-clip speed via [playbackRate](https://www.remotion.dev/docs/offthreadvideo), [GIF output](https://www.remotion.dev/docs/render-as-gif). Free for teams of 3 or fewer; source-available ([FAQ](https://www.remotion.dev/docs/license/faq)). |
| videowright | Animating the real web UI | Yes | Frame-exact rendering through Playwright ([repo](https://github.com/scosman/videowright)). |
| ffmpeg / gifski | Glue, split screens, GIFs | Yes | |
| OBS | Live capture of several windows at once | Partly ([remote control](https://obsproject.com/kb/remote-control-guide)) | Native on Linux, no auto-zoom. |
| Screen Studio | Best manual polish | No | macOS only, paid ([site](https://screen.studio/)). |
| Cap / Kap | Manual recording | No | Cap is macOS/Windows ([repo](https://github.com/capsoftware/cap)); Kap is macOS only ([site](https://getkap.co/)). |
| Arcade | Interactive click-through tours | No | Exports max out at 720p and need a paid plan. |
| Motion Canvas / Rive | Motion graphics | Motion Canvas yes, Rive no | Motion Canvas is "not meant to be a replacement for traditional video editing software"; Rive's video export needs a paid plan. |

This kit's approach: Xvfb and Chrome (and xterm.js views of tmux panes for terminals) recorded by ffmpeg, cut with Pillow and ffmpeg by timeline marks. The same principle as asciinema + Playwright + Remotion, with no Node.

## 6. Five common mistakes

| Mistake | Instead |
|---|---|
| 1. Title card and setup before the magic | Cold open on the payoff; setup happens off camera. A splash of a few seconds over the music's lead-in is the most a longer video gets. |
| 2. Text illegible at display size | Record at 2x, crop to what matters, check a still at 830 px. |
| 3. Faster than people can read | Speed up waits, never reading; one short caption per beat. |
| 4. Hard cuts that hide cause and effect | Show the action and its result in one frame (side by side if need be). |
| 5. Decoration over clarity | No music in the README GIF; in a longer video, a steady bed well under the voice. |
| Also: speed-ups not labelled | Badge every sped-up shot ("8× speed"), or don't speed up what people read. |
