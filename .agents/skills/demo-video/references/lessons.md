# Lessons

What held up across several demo videos and dozens of takes: README hero videos, a narrated series of walkthroughs, and a showcase clip of AI coding agents reviewing a real pull request. The two research notes next to this file are the outside evidence; this file is what to actually do. Where they disagree (the research says "drop the music"), this file wins, because it was tested on real takes and real viewers.

## Story

- **Show the thing only this product can do.** If one ordinary tool could do the task on screen, the demo sells nothing. Two agents doing parallel chores is just two terminals; two agents checking each other's work, conceding with evidence, and a human making the call, is a demo.
- **Use real material.** A real pull request, a real dataset, a real bug: viewers can tell. Invented exercises (FizzBuzz, a bill splitter) read as toys. Real material also turns up real findings, which is the best footage there is.
- **A disagreement needs two defensible sides, evidence (a failing test, a benchmark, a line number) and a referee.** The human sets it up in one line and calls it at the end.
- **Cast honestly.** Don't give anyone, person or agent, a position it didn't earn. If an agent wrote the code, it defends the code.
- **Open on the payoff.** A still of the finished state first, then how it got there. Nobody watches setup: installs, sign-ins and empty states happen off camera.
- **Name the category, not the example.** Open and close on what the product is for ("any job, one place"); otherwise a review demo files the product under review tools.
- **Expect several takes.** Live software does something different every run. Keep the rig cheap to re-run (minutes, not an afternoon), and write the captions after watching the take you keep.

## Picture

- **Real screen video, or nothing.** Every frame is real app state, recorded as video: never stitched screenshots, never a redrawn or mocked UI. Snapshot-and-redraw cuts look like slideshows, and viewers judge demos (agent demos above all) by whether they believe them.
- **Record on virtual displays with wall-clock timestamps.** One Xvfb display per window, Chrome as an app window, ffmpeg `x11grab -copyts`. A timeline of marks (each event with its on-screen box) drives the cut, so the framing comes from the page's real layout instead of guesswork.
- **Show cause and effect together.** When one action reaches two places (a message landing in two terminals), show both side by side in one beat instead of cutting back and forth.
- **Open on the whole picture, without a zoom.** A slow push-in on the first shot was rejected; a still of the finished app reads better.
- **Typing at real pace, cut short, never sped up.** Show the first seconds of typing, then cut to the result. Sped-up typing is unreadable. Speed up the waiting instead, and label it ("8× speed").
- **Legible at README width (about 830 px).** Record the UI at 1280×720 CSS pixels at 2 to 2.5× device scale, crop to the part that matters, and aim for text about twice its normal size in the final frame.
- **Match the pieces.** Force `prefers-color-scheme: dark` (or light) in the recorded browser so the app matches the terminals or slides beside it.
- **Commands that answer in one line.** A test runner streaming log lines buried its own result and got a cut rejected; one-liners with an immediate answer (set a value, let it settle, read it back) read at a glance. If a long run has to be shown, check the frame at the end of each beat: the line that matters may have scrolled away.
- **Say when a frame is held.** Freezing on a result long enough to read it is fine when the viewer can tell, the way a speed-up carries its badge: mark it in the caption.
- **Captions: six words or fewer, one per beat, plain.** Put a caption at the top when the bottom of the frame is the thing being shown (a text box while typing). Give each name one colour and use it everywhere.
- **Splash and end card.** A splash (icon, name, tagline) plays over the music's lead-in, and it is the file's first frame, because GitHub shows a video paused on its first frame. The end card carries the install line and the URL, and no version tag if every merge is a release.
- **GIF for the README, MP4 for depth.** GitHub autoplays and loops GIFs; it plays videos muted, and only on a click. The GIF's first frame must tell the story on its own. Keep each upload under 10 MB (GitHub's limit): CRF 22 and a single audio track fit 46 s of 1080p into 8.7 MB.

## Sound

- **Approve audio as audio.** Render the soundtrack alone (`mix.wav`, with `narration.wav` and `music.wav` beside it) and get it approved before spending minutes on each video render.
- **Narration in passages, not caption by caption.** Eight two-second lines with dead air between them sounded like captions read aloud; four passages, each spanning several beats, sounded like a narrator. The beats under a passage stretch to fit it.
- **Music: steady, under the voice, with a lead-in.** One level throughout, about 7 dB under the voice (music around -23 LUFS, voice around -16). No ducking: dipping the music under each line was tried and firmly rejected. Let the music play alone before the first line, and start that line on a pause in the track (find it in the waveform).
- **Keep the stems separate and mix last.** The first mix had the music within 2 dB of the voice; measuring loudness second by second showed it at once.
- **Static gains, no loudness dynamics on sparse speech.** One-pass `loudnorm` on a track that is mostly silence pumps.
- **Read URLs off the screen, not aloud.** "The link's on screen" beats a spoken address.
- **Voices.** Kokoro-82M, locally. `bm_george` (British male) was picked in two separate auditions, with `am_michael` (American male) the runner-up both times. Piper's voices sounded unnatural next to them. Later, heard live, the picked voice was called "a little tacky": read Kokoro's own grades (`VOICES.md` in its model repository) before an audition. When checked, `af_heart` was graded A and `af_bella` A-, but no male voice was above C+ (`am_michael`, `am_fenrir`, `am_puck`), and `bm_george` was C. Audition the same line in several voices, in one file.
- **A narrator beyond Kokoro.** The same three narration passages, loudness-matched, in Kokoro, Chatterbox and Orpheus: the picks were Chatterbox Turbo's built-in voice and Orpheus's `tara` with one `<chuckle>`. Chatterbox Turbo (MIT, 350M) rendered the passages in about 25 s on a CPU and takes cues like `[chuckle]`; every file it makes carries Resemble's inaudible watermark. Orpheus (3B) needs a GPU (a 4-bit copy took about 2 minutes on a 6 GB card), its official weights are gated, and the Llama 3.2 Community License applies to its output. Chatterbox Turbo became the narrator; Kokoro stays wherever a voice must run live on a CPU.
- **An original bed when there's no track to use.** `scripts/chiptune.py` composes one in a chosen style and stops on the cards. For polished videos a real recording still sounded better to the people they were made for: offer both.
- **Credit the music.** Use a track you're allowed to use, and put its credit line (Creative Commons Attribution tracks require one) on the end card and wherever the file is posted.

## Process

- **A handoff note isn't the brief.** Notes from someone else's talk listing five tests in detail led to a five-test cut; the person presenting wanted three. Agree the beat list with whoever will show the video.
- **Rehearse before the take.** Run the scenario once unrecorded: first runs warm caches and can be far slower (one step took 144 s cold, 7 s warm), and a step that fails costs a whole take.
- **Ask what bothers them before re-cutting.** Six takes were rejected on story before four pointed questions reset the direction in one round: what makes this complex, what's wrong with the story, what should the viewer believe afterwards, and what should be on screen.
- **A storyboard as one picture.** A frame per beat (a still from footage you already have, or a labelled card), its time, caption and source, and under it a short numbered list of the choices left, each with a recommendation. That got a decision in one round; paragraphs describing the same plan were sent back as too much text.
- **Find an exchange they loved and copy its shape, not its nouns.** The verbs of a good back-and-forth (checkable, checked, you're right, not for that reason, override accepted) transplant to a new subject.
- **Reference videos beat descriptions.** Ask for one or two they like.
- **Ship deliverables, not tooling.** The product's repository gets the GIF and the uploaded MP4; the recorder and editor stay in this kit. Video tooling was once pulled back out of a product's pull request for exactly that reason.
- **Never build in a scratch directory.** Session scratch space gets wiped; one whole pipeline was lost that way. Rigs live in the kit's `projects/<name>/`, raw takes in `~/recordings/<name>/`.
- **Two rigs, one machine.** To film two demos on one machine at once, give each rig its own range of X display numbers and queue every take on one machine-wide lock (`flock`), so two takes never run together and neither steals the other's CPU mid-take.
- **A real take is a test of the product.** Takes have exposed real bugs: a review that sat still for 18 minutes because an update woke nobody, a long option clipped in the UI. Say so, fix them, and re-record. That is failing fast, and it's worth it.

## Demos of coding agents

- **Roles in the prompt, etiquette in the repository.** The typed line says who does what ("A, review it. B, you wrote it: push back where A is wrong, concede where it's right"). How to talk (plain sentences, under 25 words, check a claim before accepting it, say "confirmed" or what you found instead) goes in the demo checkout's `AGENTS.md` and `CLAUDE.md`, out of frame.
- **Give the author its intent.** An agent defending code argues better with the reasoning behind it: hand it a words-only slice of the session where the code was written (the messages, the issue, the pull request), and only to the author.
- **Declined approvals stall a fixer.** A rig that declines every approval prompt lets agents review but not fix. Pre-allow exactly what the take needs (or use the harness's auto mode in the throwaway checkout), and tell the agent to edit with its edit tool rather than with shell scripts.
- **The demo checkout's instructions must match the take.** If the agent should fix in place on the checked-out branch, say so; a general rule like "make a worktree" will otherwise send it somewhere the camera isn't.
- **End a take on a settled state.** Nothing moved for a minute, the work had its time, and an agent waiting for messages counts as idle.
- **Keep secrets off disk and off screen.** Read sign-in links and tokens from an unrecorded terminal and pass them in memory. Use a demo account and made-up data.
- **A copied login can't renew itself.** A rig that runs a real agent CLI from a copy of the person's login (so their real configuration stays untouched) stalled mid-take when the access token expired: the copy can't refresh, and writing a refreshed token back would touch the real configuration. Check the token's expiry before a take; if it's close, ask the person to start the CLI once so it renews.
- **Film a call through a participant you run.** A video-call platform's guest page refused a scripted browser. Rather than work around its bot check, the call was shown through the screen of a meeting bot already in it, with the address bar (it held the meeting ID) cropped off. A join link carries its passcode: keep it in a mode-0600 file, never on a command line or in an environment variable, a log or a caption.

## Rig gotchas

- **CDP: don't enable a domain you won't drain.** `Network.enable` filled the socket's queue and the keepalive timed out; `Network.setCookies` works without it.
- **CDP's screencast misses native full screen.** `Page.startScreencast` doesn't include the Fullscreen API's top layer: a full-screen view recorded that way showed the page underneath it. x11grab of the virtual display captures it, and so do timed screenshots.
- **A second window is an app window on the same origin.** Start it on the app's own URL (not `about:blank`, which brings tabs and an address bar), copy the session cookies over CDP, and reload.
- **Frame from the layout after the click.** Opening a panel can move everything; measure boxes after the move, not before.
- **Chrome on a Wayland desktop can open on your real screen.** Unset `WAYLAND_DISPLAY`, pass `--ozone-platform=x11` and point `DISPLAY` at the virtual display.
- **Stop ffmpeg with `q` on stdin, not `-t`.** With `-copyts`, a Matroska file cut by `-t` came out unreadable.
- **WSL2 steps the clock.** It follows Windows' clock in jumps (about 2 s at a time was seen), and ffmpeg's capture pauses until the clock catches up, so a mark made just after a jump can land early. The recorder notes each jump in the timeline and warns at the end of the take.
- **WSL2: Xvfb can't create its socket file**, because WSLg owns `/tmp/.X11-unix`. It still listens on the abstract socket, so check a display by connecting to it, not by looking for the file.
- **tmux:** `set-option -g window-size manual` crashed tmux 3.6 at the next `new-session`; read-only viewers attach at the pane's size anyway.
- **tmux reads a `;` argument as its command separator,** `send-keys -l` included: `echo a; echo b` arrived as `echo a echo b`. The kit sends semicolons as hex (`send-keys -H 3b`).
- **Chrome in Docker: keep the sandbox.** The default seccomp profile leaves Chrome no usable sandbox, and `--no-sandbox` puts an "unsupported command-line flag" bar across the top of every recorded frame. `--security-opt seccomp=unconfined` lets the sandbox work and leaves the frame clean.
- **Headless screenshots and webfonts:** a URL fragment (`#section`) scrolls before the webfonts load and leaves a band of whitespace; scroll by measured offsets instead.
