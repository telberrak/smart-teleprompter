# Smart Teleprompter

An offline desktop teleprompter for recording course videos. It follows your voice, records sentence by sentence, cuts silences and bad takes, writes captions from the script, and shows each diagram step as you say it.

Milestones 1–5 are in: captions, review/redo/export, recording, the prompter, and **voice following** with whisper.cpp (offline, on the CPU).

## Run it (Windows)

Needs [Node.js 22 or newer](https://nodejs.org) and Git.

```powershell
cd C:\Workspace\local_repo\smart-teleprompter
npm install
npm run dev      # desktop app with hot reload
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm start` | Build, then open the desktop app |
| `npm run web` | Open the interface in a browser at http://localhost:5173 (no file saving) |
| `npm test` | Run the script parser tests |
| `npm run typecheck` | Check TypeScript types |

## Screens

- **Prepare**: open a `1.x-whiteboard-script.md`, check it, and edit any sentence in place. Edits are saved straight to the file.
- **Record**: the prompter. The current sentence sits on the eye line under the camera.
- **Review**: takes by sentence. "Redo" jumps back to Record two sentences early for a run-up. (Sample takes until milestone 3.)
- **Production**: assemble the finished video on a timeline, like CapCut, then polish and export.

### Record shortcuts

| Key | Action |
| --- | --- |
| Space | Start or pause |
| ← | Back one sentence |
| E, or click a line | Pause and edit that sentence. Enter saves to the script, Esc cancels |
| M | Mirror for teleprompter glass |
| W | Whiteboard mode: slide in the middle, text scrolling underneath (toggle) |

## Voice following

On the Record screen, set **Voice → Microphone** in the Prompter panel. Pick a **Speech model**:

| Model | Size | Use it when |
| --- | --- | --- |
| Tiny | 75 MB | Fastest. Slow computers, or you want the scroll as tight as possible |
| Base | 142 MB | Default: fast and accurate |
| Small | 466 MB | Most accurate; needs a good graphics card to keep up |
| Your own file… | | Any whisper.cpp `ggml-*.bin` you already have |

A model downloads from Hugging Face the first time you pick it, into the app's data folder
(`%APPDATA%\smart-teleprompter\models`). After that everything runs offline. Switching loads the
model and measures it, so the panel shows the real seconds per listen on your computer.

**Fast listening** (on by default) tells whisper to read only the 4 seconds it is given instead of
its usual fixed 30-second window, which makes each listen several times faster. Turn it off if
words come out wrong with your model.

Press Space and start talking. The app transcribes the last 4 seconds again and again and lines the
words up with the script, so the text follows you; misheard words, ad-libs and pauses are ignored, and
re-reading an earlier line takes you back there. Because each listen describes where you were when it
started, the scroll also moves on by what you said meanwhile, at your measured pace (up to 6 words,
never into the next sentence). **Simulated** keeps the old steady-pace demo.

The engine is the prebuilt whisper.cpp addon `@fugood/node-whisper-win32-x64` (installed by
`npm install`, no compiler needed).

## Recording

The camera preview shows in the bottom-left of the Record screen; pick the camera (or audio only)
in the **Recording** panel. Every press of Space starts a new take and the next press stops it.
Takes go to `takes/<script name>/` next to the script, e.g.

    samples/1.1/takes/1.1-whiteboard-script/take-01.webm
    samples/1.1/takes/1.1-whiteboard-script/take-01.json   <- start/end second of every sentence

The audio is recorded raw (no noise suppression or auto gain) from the microphone chosen under
Voice. With voice following, sentence times trail your voice by `follow.lagSeconds`.

## Review, redo and export

**Review** lists every sentence with each read found in your takes (T1, T2·2 = take 2, second
read…). The **last read wins** (★), so fluff, say it again, carry on. Click another read to use it
instead (and to play it). **Redo** jumps to Record at that sentence; the new take replaces it.

Cut points come from the sentence times in each take, shifted back by the voice-following lag
and snapped to the nearest silence (FFmpeg `silencedetect`, −35 dB, 0.2 s). **Export MP4** writes
`takes/<script>/<script>-cut.mp4` (1080p30 H.264 + AAC) plus a `-cut.json` with every segment.
FFmpeg is bundled through npm (`@ffmpeg-installer/ffmpeg`), nothing to install.

Every export also writes `<script>-cut.srt`: captions with your script's exact wording (stress
marks removed), split into lines of at most 42 characters at punctuation and timed from the cut.
Tick **Also make a copy with captions burnt in** for `<script>-cut-captioned.mp4`.

## Whiteboard video and Remotion

**Make whiteboard video** turns the cut into the finished lesson, `<script>-whiteboard.mp4`:

- Before the first `[ON SCREEN]` note (the cold open) your camera fills the screen.
- From then on, the slide for the current step fills the screen and your camera sits in a round
  bubble in the corner you pick under **Camera bubble** (top left, top right, bottom left, bottom
  right; default bottom right). Slides change at the sentence after each note.
  The same setting is on the Record screen: in Whiteboard mode the bubble shows over the slide there
  too, so you can check it does not hide anything.
- Captions are burnt in under the slide (untick **Captions on the whiteboard video** to leave them out).

Slides are drawn from your `.excalidraw` frames at 1920x1080 (`<script>-slides/step-NN.png`);
without slides, the ON SCREEN note text is used as a title card. With audio-only takes there is
no bubble and the cold open shows the first slide. The cut is reused if it has not changed.

Every run also writes `<script>-timeline.json` (scenes, slide pictures, captions and sentence
times in cut time), and with **Also write a Remotion project** a ready Remotion project in
`<script>-remotion/` with the cut, slides and timeline in `public/`:

```
cd takes/<script>/<script>-remotion
npm install
npm run studio   # preview, tweak src/Whiteboard.tsx (bubble size, animations, captions)
npm run render   # out/whiteboard.mp4
```

In Remotion the camera shrinks smoothly into the bubble and slides fade in. Exporting again
refreshes `public/` and keeps your edits in `src/`. The template lives in `remotion-template/`.

## Script markup

The parser reads the course scripts as they are written today:

```markdown
**Reliability, Scalability, Maintainability: The Three Questions**
(About 12 minutes. Format: Detailed, timed at 228 spoken words per minute plus pauses.)
Bold = stress. / = brief pause. [pause] = 1 second. [long pause] = 2 to 3 seconds.

=== PART 1. COLD OPEN ===

[ON SCREEN: a trading floor at 9:31 in the morning.]

Picture a Monday morning at a bank. / The market opened one minute ago. [pause]
```

| Markup | Meaning |
| --- | --- |
| `**Title**` or `# Title` on the first line | Video title |
| `(...)` lines, `Bold = ...` legend | Skipped. "timed at N words per minute" sets the target pace |
| `=== PART 1. NAME ===` or `## Name` | Section |
| `[ON SCREEN: any text]` | Next diagram step (numbered in order), shown at the next sentence. Hidden on the prompter |
| `[ON SCREEN: step 3]` | Explicit step number |
| `[pause]`, `[long pause]`, `[pause 2s]` | Hold after the previous sentence: 1 s, 2.5 s, or the given time, with a countdown bar |
| `/` | Breath mark (0.3 s) |
| `**words**` | Stressed words, can span several words and breath marks |
| `{intro}` `{key}` `{def}` `{ex}` `{tr}` | Optional colour tags. Without tags, sentences alternate navy and orange like the reading scripts |

Put your own course files in `samples/` to try them; that folder is not committed.

## Production

Production starts from Review's cut (your best take of each sentence, silences removed) and
lays it out on seven lanes: titles, camera, slides, voice, music, sound effects and captions.

- **Preview** plays the cut with slides, camera bubble, titles and captions drawn as they will export.
- **Library**: Media (camera layouts), Text (title card, lower third, chapter, key term, end card),
  Audio (your music, a whoosh or pop made by the app) and Brand (accent colour, name, course).
- **Timeline**: click to seek, drag titles and sound effects (they snap to sentence starts),
  `S` splits the selected clip at the playhead, `Delete` removes it, `Space` plays. "Fit" shows the whole video.
- **Inspector**: change the selected clip, e.g. camera full screen or bubble for part of the video,
  a slow zoom on a slide, music volume and ducking, caption style.
- **Polish & export** runs pro checks first (camera bubble hiding slide text, slides on screen at
  least 3 s, caption reading speed, intro under 8 s, overlapping titles) with one-click fixes, then writes:
  - `NAME-final.mp4` 1920x1080, voice cleaned, music ducked under your voice, loudness −14 LUFS (or −16)
  - `NAME-cut.srt` captions, `NAME-description.txt` with YouTube chapter timestamps
  - `NAME-thumbnail.png` 1280x720 from the slide you pick, the lesson title and your face
  - `NAME-production.json` so the edit can be reopened

Use only music you own or have a licence for.

## Roadmap

1. ✅ Prompter
2. ✅ Voice follow: whisper.cpp live, scroll follows you, goes back on repeats
3. ✅ Recording: camera and mic, with a marker at each sentence
4. ✅ Re-record one sentence, keep the best take, FFmpeg cuts silences
5. ✅ Captions (SRT) from the script, timed to your voice
6. ✅ Diagrams in the final video: whiteboard MP4, plus a Remotion timeline and project
7. ✅ Production: timeline editor, titles, music, pro checks, final MP4, chapters and thumbnail
8. Next: a 60 s vertical Short (9:16) from key sentences

## Project layout

```
electron/   main process and preload (file open/save)
src/lib/    script parser and file bridge
src/components/  Prepare, Record, Review, Production screens
src/sample/ sample script
remotion-template/  Remotion project copied next to your takes on export
```
