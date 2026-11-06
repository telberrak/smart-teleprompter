# Smart Teleprompter

An offline desktop teleprompter for recording course videos. It follows your voice, records sentence by sentence, cuts silences and bad takes, writes captions from the script, and shows each diagram step as you say it.

This is **milestone 1: the prompter**. The voice is simulated with a steady reading pace; whisper.cpp arrives in milestone 2.

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
2. Voice follow: whisper.cpp live, scroll follows you, goes back on repeats
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
