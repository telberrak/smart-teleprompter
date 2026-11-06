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

```markdown
# 1.3 What is an API?

[ON SCREEN: step 1]
{intro} Welcome back. In this lesson we look at how an API lets two programs talk.
{key} Think of an API as a **waiter** in a restaurant. [pause 1s]
{ex} You read the menu, / you place an order, / and the kitchen does the work.
```

| Markup | Meaning |
| --- | --- |
| `[ON SCREEN: step 3]` | Show diagram step 3 at the next sentence. Hidden on the prompter |
| `[ON SCREEN: any text]` | Shown as a small cue on the next sentence |
| `[pause 2s]`, `[pause]` | Hold after the previous sentence (default 1 s), with a countdown bar |
| `/` | Breath mark |
| `**word**` | Stressed word: bold and larger |
| `{intro}` `{key}` `{def}` `{ex}` `{tr}` | Optional sentence colour; it carries on until the next tag on the same line |

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
