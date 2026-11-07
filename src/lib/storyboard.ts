// The whiteboard video's storyboard: which slide is on screen when, in final-cut time.
//
// Each sentence shows the diagram step of the last [ON SCREEN] note at or before it.
// Before the first note (the cold open) the camera fills the screen; after that the slide
// fills the screen and the camera sits in a round bubble in the corner.
import type { Segment } from "./edit";
import type { Script } from "./script";
import { cues, type Cue } from "./captions";

export interface Scene {
  /** "camera": full-screen camera. "slide": slide full screen, camera bubble. */
  kind: "camera" | "slide";
  /** Diagram step shown (0 = before the first ON SCREEN note). */
  step: number;
  /** Seconds in the final cut. */
  start: number;
  end: number;
}

/** Diagram step for sentence n (1-based). */
export const stepAt = (script: Script, n: number) =>
  script.sentences.slice(0, n).reduce((a, s) => s.step ?? a, 0);

/**
 * Scenes for the cut, one per run of sentences on the same step.
 * `hasCamera` false (audio-only takes): the cold open shows the first slide instead.
 */
export function scenes(segs: Segment[], script: Script, hasCamera = true): Scene[] {
  const firstStep = script.sentences.find(s => s.step)?.step ?? 0;
  const out: Scene[] = [];
  let t = 0;
  for (const s of segs) {
    const d = s.end - s.start;
    let step = stepAt(script, s.sentence);
    if (!hasCamera && step === 0) step = firstStep;
    const kind = step === 0 ? "camera" : "slide";
    const last = out.at(-1);
    if (last && last.step === step && last.kind === kind) last.end = t + d;
    else out.push({ kind, step, start: t, end: t + d });
    t += d;
  }
  return out.map(x => ({ ...x, start: +x.start.toFixed(3), end: +x.end.toFixed(3) }));
}

/** Everything a renderer needs (FFmpeg here, or the Remotion project): written as timeline.json. */
export interface Timeline {
  version: 1;
  title: string;
  fps: number;
  width: number;
  height: number;
  seconds: number;
  /** The joined cut (camera + voice), relative to the timeline file. */
  video: string;
  scenes: (Scene & { image?: string })[];
  captions: Cue[];
  /** The sentences of the cut, in cut time, for editors that want to restyle them. */
  sentences: { sentence: number; take: number; start: number; end: number; text: string }[];
}

export function buildTimeline(segs: Segment[], script: Script, opts: { hasCamera: boolean; video: string; image: (step: number) => string }): Timeline {
  const sc = scenes(segs, script, opts.hasCamera);
  let t = 0;
  const sentences = segs.map(s => {
    const d = s.end - s.start;
    const row = { sentence: s.sentence, take: s.take, start: +t.toFixed(3), end: +(t + d).toFixed(3), text: script.sentences[s.sentence - 1]?.spoken ?? s.text };
    t += d;
    return row;
  });
  return {
    version: 1, title: script.title, fps: 30, width: 1920, height: 1080, seconds: +t.toFixed(3), video: opts.video,
    scenes: sc.map(x => (x.kind === "slide" ? { ...x, image: opts.image(x.step) } : x)),
    captions: cues(segs, n => script.sentences[n - 1]?.spoken ?? "").map(c => ({ ...c, start: +c.start.toFixed(3), end: +c.end.toFixed(3) })),
    sentences,
  };
}

/** Steps that need a slide image. */
export const slideSteps = (sc: Scene[]) => [...new Set(sc.filter(s => s.kind === "slide").map(s => s.step))];
