# Delivering the video

The deliverable is the files, handed to the person who asked: `out/<name>.mp4`, `out/<name>.gif`, the music's credit line if the video has music, and `out/commands.txt` if the take typed into a terminal (the lines on camera, for people to copy). Where they go next is their call. Don't upload anything to a public place on your own.

## Sizes

- GitHub takes uploads up to 10 MB (GIFs, and videos on free plans). The render warns above `--max-mb`.
- If the MP4 is over: shorten the cut first (30–45 s is plenty), then drop `--stems`, then raise CRF a notch (`cut.CRF`, default 22). Past about 26, text gets soft.
- If the GIF is over: fewer shots, a shorter hold, or a smaller `cut.GIF_W` (default 960) or `cut.GIF_FPS` (default 12).

## In a GitHub README

- **The GIF** goes right under the one-line pitch, before the install steps. It loops, autoplays (except for viewers who turn on reduced motion) and needs no click. Commit it to the repository (for example `docs/media/demo.gif`) or upload it as below.
- **The MP4** plays only on a click, muted at first, so it's for depth, not the hero. GitHub plays a video inline only when it's uploaded to GitHub itself: in the browser, drag the file into an issue, pull request or README edit box; GitHub uploads it to `github.com/user-attachments/assets/...` and inserts the link. Put that link on its own line in the README.
- Put the install commands in the README as text people can copy, not only on the end card.

## On a docs site

- **Use the same upload.** A docs site built from the repository plays the MP4 GitHub already holds: upload it as an attachment to a pull request (GitHub gives it a `https://github.com/user-attachments/assets/…` address) and embed that address with `<video controls preload="metadata" width="100%" src="…"></video>`. The video never enters git.
- **Open each feature page on its video.** Long feature pages with no video were called far too long: the ask was a short page that opens with a real take, the detail moved to a reference page. Plan a feature's video with the feature, not after it.

## Ship deliverables, not tooling

The product's repository gets the media and nothing else: not the recorder, not the editor, not the take. The rig stays in this kit's `projects/<name>/`, the take in `~/recordings/<name>/`, so the video can be re-cut or re-recorded when the UI changes.

## Before handing it over

- Watch the whole MP4 once with sound, and the GIF once without.
- Check the first frame of each: the MP4's is the splash, the GIF's tells the story on its own.
- Check nothing private is on screen: real names, emails, tokens, customer data, your desktop.
- Say where the raw take is, and how to re-cut it (`edit.py --build <take> …`).
