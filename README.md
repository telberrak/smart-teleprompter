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

### Record shortcuts

| Key | Action |
| --- | --- |
| Space | Start or pause |
| ← | Back one sentence |
| E, or click a line | Pause and edit that sentence. Enter saves to the script, Esc cancels |
| M | Mirror for teleprompter glass |
| W | Whiteboard mode: slide in the middle, text scrolling underneath (toggle) |

## Voice following

On the Record screen, set **Voice → Microphone** in the Prompter panel. The first time, click
**Download speech model**: it fetches `ggml-base.en.bin` (148 MB) from Hugging Face into the app's
data folder (`%APPDATA%\smart-teleprompter\models`). After that everything runs offline. If you
already have a whisper.cpp model, use **Use a model file…** instead.

Press Space and start talking. Every ~0.4 s the app transcribes the last 4 seconds and lines the
words up with the script, so the text follows you; misheard words, ad-libs and pauses are ignored, and
re-reading an earlier line takes you back there. **Simulated** keeps the old steady-pace demo.

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

## Roadmap

1. Prompter (this version)
2. ✅ Voice follow: whisper.cpp live, scroll follows you, goes back on repeats
3. Recording: camera, mic and screen, with a marker at each sentence
4. Re-record one sentence, keep the best take, FFmpeg cuts silences
5. Captions (SRT, VTT) from the script, timed to your voice
6. Diagrams: Excalidraw steps live, exported as a Remotion timeline

## Project layout

```
electron/   main process and preload (file open/save)
src/lib/    script parser and file bridge
src/components/  Prepare, Record, Review screens
src/sample/ sample script
```
