// Production: the finished lesson as tracks of clips, built from Review's cut and the script.
//
// Everything is in cut time (seconds from the start of the cut). The cut itself (voice + camera)
// runs underneath; the tracks say what is drawn over it and how the sound is finished.
import type { Segment } from "./edit";
import type { Script } from "./script";
import { cues, type Cue } from "./captions";
import { scenes } from "./storyboard";
import { bubbleXY, type Corner } from "./bubble";
import { frameBoxes, overlap, type Box } from "./slideLayout";
import type { Frame } from "./excalidraw";

export type TrackId = "titles" | "camera" | "slides" | "voice" | "music" | "sfx" | "captions";
export const TRACKS: { id: TrackId; tag: string; name: string }[] = [
  { id: "titles", tag: "T", name: "Titles" },
  { id: "camera", tag: "V2", name: "Camera" },
  { id: "slides", tag: "V1", name: "Slides" },
  { id: "voice", tag: "A1", name: "Voice" },
  { id: "music", tag: "A2", name: "Music" },
  { id: "sfx", tag: "FX", name: "Sound effects" },
  { id: "captions", tag: "CC", name: "Captions" },
];

export type TitleKind = "title" | "lower" | "chapter" | "term" | "outro";
export type CameraLayout = "full" | "bubble" | "hidden";
export type SlideEnter = "cut" | "fade";
export type SlideMotion = "none" | "zoom";
export type Duck = "off" | "gentle" | "strong";
export type CaptionStyle = "clean" | "bold" | "off";
export type Sound = "whoosh" | "pop";

interface Base { id: string; start: number; end: number }
export interface TitleClip extends Base { track: "titles"; kind: TitleKind; text: string; sub: string }
export interface CameraClip extends Base { track: "camera"; layout: CameraLayout; corner: Corner }
export interface SlideClip extends Base { track: "slides"; step: number; enter: SlideEnter; motion: SlideMotion; /** Bubble corner over this slide, if different from the camera's. */ corner?: Corner }
export interface VoiceClip extends Base { track: "voice"; clean: boolean; loudness: -14 | -16 }
export interface MusicClip extends Base { track: "music"; file: string; volume: number; duck: Duck; fadeOut: number }
export interface SfxClip extends Base { track: "sfx"; sound: Sound; volume: number }
export interface CaptionClip extends Base { track: "captions"; style: CaptionStyle }
export type Clip = TitleClip | CameraClip | SlideClip | VoiceClip | MusicClip | SfxClip | CaptionClip;

export interface Brand {
  /** Shown in the lower third. */
  name: string;
  /** Course or channel, under the name. */
  course: string;
  accent: string;
  /** Text on the outro card. */
  outro: string;
}
export const DEFAULT_BRAND: Brand = { name: "Your name", course: "Your course", accent: "#f4b860", outro: "Next lesson coming up" };

export interface Production {
  version: 1;
  /** The cut this was built from: when it changes the production is rebuilt. */
  cutKey: string;
  title: string;
  seconds: number;
  brand: Brand;
  clips: Clip[];
  /** Sentences picked for the vertical Short (suggested until you change them). */
  short?: number[];
}

export const cutKey = (segs: Segment[]) => segs.map(s => `${s.sentence}:${s.take}:${s.start}-${s.end}`).join("|");
export const cutSeconds = (segs: Segment[]) => +segs.reduce((a, s) => a + (s.end - s.start), 0).toFixed(3);

let n = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(n++).toString(36)}`;
const r3 = (x: number) => +x.toFixed(3);

/** Sentence start times in the cut, and each sentence's section. */
function sentenceTimes(segs: Segment[], script: Script) {
  let t = 0;
  return segs.map(s => {
    const row = { sentence: s.sentence, start: t, end: t + (s.end - s.start), section: script.sentences[s.sentence - 1]?.section };
    t = row.end;
    return row;
  });
}

/** Clean section names: "PART 2. THE WAITER" → "The waiter". */
export function chapterName(section: string): string {
  const s = section.replace(/^\s*(part|chapter|section)\s*\d+[.:)\-–—]?\s*/i, "").trim() || section.trim();
  return s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s;
}

/** Chapters: one per script section, at the first sentence of it that is in the cut. */
export function chapters(segs: Segment[], script: Script): { start: number; name: string }[] {
  const out: { start: number; name: string }[] = [];
  let last: string | undefined;
  for (const s of sentenceTimes(segs, script)) {
    if (s.section && s.section !== last) out.push({ start: r3(s.start), name: chapterName(s.section) });
    last = s.section ?? last;
  }
  if (out.length && out[0].start > 0) out.unshift({ start: 0, name: "Intro" });
  return out;
}

/** The production a fresh cut starts with: everything placed, nothing to drag into place by hand. */
export function buildProduction(segs: Segment[], script: Script, opts: { hasCamera: boolean; corner: Corner; brand?: Brand; whoosh?: boolean }): Production {
  const total = cutSeconds(segs);
  const brand = opts.brand ?? DEFAULT_BRAND;
  const clips: Clip[] = [];
  const sc = scenes(segs, script, opts.hasCamera);

  // Titles: lesson title at the start, lower third with your name, a card at each chapter, the outro.
  clips.push({ id: uid("t"), track: "titles", kind: "title", start: 0, end: Math.min(4, total), text: script.title, sub: brand.course });
  if (total > 8) clips.push({ id: uid("t"), track: "titles", kind: "lower", start: 4.5, end: Math.min(10, total - 1), text: brand.name, sub: brand.course });
  for (const ch of chapters(segs, script).slice(1)) {
    if (ch.start < 10 || ch.start > total - 6) continue;
    clips.push({ id: uid("t"), track: "titles", kind: "chapter", start: ch.start, end: r3(Math.min(ch.start + 3, total)), text: ch.name, sub: "" });
  }
  if (total > 20) clips.push({ id: uid("t"), track: "titles", kind: "outro", start: r3(total - 5), end: total, text: brand.outro, sub: script.title });

  // Camera: full screen until the first slide, then the bubble.
  if (opts.hasCamera) {
    for (const s of sc) {
      const layout: CameraLayout = s.kind === "camera" ? "full" : "bubble";
      const last = clips.at(-1);
      if (last?.track === "camera" && last.layout === layout) last.end = s.end;
      else clips.push({ id: uid("c"), track: "camera", layout, corner: opts.corner, start: s.start, end: s.end });
    }
  }
  // Slides: one clip per ON SCREEN step.
  for (const s of sc) if (s.kind === "slide") clips.push({ id: uid("s"), track: "slides", step: s.step, enter: "fade", motion: "none", start: s.start, end: s.end });

  clips.push({ id: uid("v"), track: "voice", clean: true, loudness: -14, start: 0, end: total });
  // A soft whoosh as each slide comes in (not the first one).
  if (opts.whoosh !== false)
    for (const s of sc.filter(x => x.kind === "slide").slice(1)) clips.push({ id: uid("x"), track: "sfx", sound: "whoosh", volume: -18, start: r3(Math.max(0, s.start - 0.3)), end: r3(s.start + 0.5) });
  clips.push({ id: uid("cc"), track: "captions", style: "clean", start: 0, end: total });

  return { version: 1, cutKey: cutKey(segs), title: script.title, seconds: total, brand, clips };
}

export const clipsOn = <T extends TrackId>(p: Production, track: T) =>
  p.clips.filter((c): c is Extract<Clip, { track: T }> => c.track === track).sort((a, b) => a.start - b.start);

/** What is on screen at time t. */
export function at(p: Production, t: number) {
  const on = <T extends TrackId>(track: T) => clipsOn(p, track).filter(c => t >= c.start && t < c.end);
  const slide = on("slides")[0];
  const cam = on("camera")[0];
  return {
    slide, titles: on("titles"), camera: cam,
    corner: (slide?.corner ?? cam?.corner ?? "br") as Corner,
    layout: (cam?.layout ?? (slide ? "hidden" : "full")) as CameraLayout,
  };
}

/** Change one clip. */
export function update(p: Production, id: string, patch: Partial<Clip>): Production {
  return { ...p, clips: p.clips.map(c => (c.id === id ? ({ ...c, ...patch } as Clip) : c)) };
}

export function remove(p: Production, id: string): Production {
  return { ...p, clips: p.clips.filter(c => c.id !== id) };
}

/** Cut a clip in two at t (both halves keep its settings). */
export function split(p: Production, id: string, t: number): Production {
  const c = p.clips.find(x => x.id === id);
  if (!c || t <= c.start + 0.2 || t >= c.end - 0.2) return p;
  const right = { ...c, id: uid(c.id[0]), start: r3(t) } as Clip;
  return { ...p, clips: [...p.clips.map(x => (x.id === id ? ({ ...x, end: r3(t) } as Clip) : x)), right] };
}

/** Move a clip, keeping its length and staying inside the video. */
export function move(p: Production, id: string, start: number): Production {
  const c = p.clips.find(x => x.id === id);
  if (!c) return p;
  const d = c.end - c.start;
  const s = r3(Math.max(0, Math.min(p.seconds - d, start)));
  return update(p, id, { start: s, end: r3(s + d) });
}

export function add(p: Production, clip: Omit<Clip, "id">): Production {
  return { ...p, clips: [...p.clips, { ...clip, id: uid(clip.track[0]) } as Clip] };
}

/** Sentence boundaries in the cut: the magnet snaps here. */
export const snapPoints = (segs: Segment[]) => {
  let t = 0;
  return [0, ...segs.map(s => (t += s.end - s.start))].map(r3);
};
export function snap(t: number, points: number[], within = 0.4): number {
  let best = t, d = within;
  for (const x of points) { const e = Math.abs(x - t); if (e < d) { d = e; best = x; } }
  return best;
}

// ── Pro checks ───────────────────────────────────────────────────────────────

export interface Check { id: string; name: string; ok: boolean; detail: string; fix?: { label: string; apply: (p: Production) => Production } }

const BUBBLE = 360, MARGIN = 56;
const bubbleBox = (c: Corner): Box => ({ ...bubbleXY(c, 1920, 1080, BUBBLE, MARGIN), w: BUBBLE, h: BUBBLE });
const CORNER_ORDER: Corner[] = ["br", "tr", "bl", "tl"];
const coverOf = (boxes: Box[], c: Corner) => boxes.reduce((a, b) => a + overlap(b, bubbleBox(c)), 0);

/** The corner where the bubble hides the least of this slide's drawing. */
export function bestCorner(frame: Frame): { corner: Corner; covered: number } {
  const boxes = frameBoxes(frame);
  let best = { corner: "br" as Corner, covered: Infinity };
  for (const c of CORNER_ORDER) { const v = coverOf(boxes, c); if (v < best.covered - 1) best = { corner: c, covered: v }; }
  return best;
}

/**
 * Checks run before export. frameFor(step) gives the Excalidraw frame of a step when slides
 * are loaded, so the bubble can be tested against what is really drawn.
 */
export function proChecks(p: Production, script: Script, segs: Segment[], frameFor: (step: number) => Frame | undefined): Check[] {
  const out: Check[] = [];
  const slides = clipsOn(p, "slides");
  const titles = clipsOn(p, "titles");
  const cams = clipsOn(p, "camera");
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // Bubble over slide text
  const hits: { clip: SlideClip; corner: Corner; to: Corner }[] = [];
  for (const s of slides) {
    const f = frameFor(s.step);
    const cam = cams.find(c => c.layout === "bubble" && c.start < s.end && c.end > s.start);
    if (!f || !cam) continue;
    const corner = s.corner ?? cam.corner;
    const covered = coverOf(frameBoxes(f), corner);
    if (covered > 400) {
      const best = bestCorner(f);
      if (best.corner !== corner && best.covered < covered) hits.push({ clip: s, corner, to: best.corner });
    }
  }
  const NAMES: Record<Corner, string> = { tl: "top left", tr: "top right", bl: "bottom left", br: "bottom right" };
  out.push(hits.length
    ? { id: "bubble", name: "Camera bubble never hides slide text", ok: false,
        detail: hits.map(h => `Step ${h.clip.step} (${mmss(h.clip.start)}): move it ${NAMES[h.to]}`).join(" · "),
        fix: { label: hits.length === 1 ? `Move it ${NAMES[hits[0].to]} there` : `Move it on ${hits.length} slides`, apply: q => hits.reduce((a, h) => update(a, h.clip.id, { corner: h.to }), q) } }
    : { id: "bubble", name: "Camera bubble never hides slide text", ok: true, detail: slides.length ? "Checked against every slide" : "No slides" });

  // Slides long enough to read
  const short = slides.filter(s => s.end - s.start < 3);
  out.push({ id: "slidelen", name: "Each slide stays up at least 3 s", ok: !short.length,
    detail: short.length ? short.map(s => `step ${s.step}: ${(Math.floor((s.end - s.start) * 10) / 10).toFixed(1)} s`).join(", ") : slides.length ? `Shortest: ${Math.min(...slides.map(s => s.end - s.start)).toFixed(1)} s` : "No slides" });

  // Captions readable: at most ~20 characters per second
  const cap = clipsOn(p, "captions")[0];
  if (cap && cap.style !== "off") {
    const list: Cue[] = cues(segs, n => script.sentences[n - 1]?.spoken ?? "");
    const fast = list.filter(c => c.text.length / Math.max(0.1, c.end - c.start) > 20);
    out.push({ id: "capspeed", name: "Captions are slow enough to read", ok: fast.length <= Math.ceil(list.length * 0.05),
      detail: fast.length ? `${fast.length} of ${list.length} captions are over 20 characters a second` : `${list.length} captions, one line each, 42 characters max` });
  } else out.push({ id: "capspeed", name: "Captions are on", ok: false, detail: "Most people watch with the sound off at least part of the time",
    fix: cap ? { label: "Turn captions on", apply: q => update(q, cap.id, { style: "clean" }) } : undefined });

  // Intro short
  const intro = titles.find(t => t.kind === "title");
  out.push({ id: "intro", name: "Intro under 8 seconds", ok: !intro || intro.end <= 8, detail: intro ? `Title card ends at ${intro.end.toFixed(1)} s` : "No title card" });

  // Titles don't pile up
  const clash = titles.find((a, i) => titles.some((b, j) => j > i && b.start < a.end && b.end > a.start && (a.kind === b.kind || (a.kind !== "lower" && b.kind !== "lower"))));
  out.push({ id: "titles", name: "Titles never sit on top of each other", ok: !clash, detail: clash ? `“${clash.text}” at ${mmss(clash.start)} overlaps another title` : `${titles.length} titles` });

  // Words match the script
  out.push({ id: "words", name: "Words match the script", ok: true, detail: "Captions and titles come from your script, not speech-to-text" });

  // Sound
  const voice = clipsOn(p, "voice")[0];
  const music = clipsOn(p, "music")[0];
  out.push({ id: "loud", name: `Loudness ${String(voice?.loudness ?? -14).replace("-", "\u2212")} LUFS, peaks under −1.5 dB`, ok: true,
    detail: `Measured and set during export${music ? `; music ducks ${music.duck === "off" ? "off" : "under your voice"}` : ""}` });
  if (music && music.duck === "off")
    out.push({ id: "duck", name: "Music dips when you speak", ok: false, detail: "Music at full level fights your voice", fix: { label: "Duck gently", apply: q => update(q, music.id, { duck: "gentle" }) } });

  return out;
}

// ── Exports that are not video ───────────────────────────────────────────────

/** YouTube description: title, then chapter timestamps (YouTube wants the first at 0:00 and 3+ chapters). */
export function description(p: Production, segs: Segment[], script: Script): string {
  const ch = chapters(segs, script);
  const stamp = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}` : `${Math.floor(s / 60)}`) + `:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const lines = [p.title, ""];
  if (ch.length >= 3) lines.push(...ch.map(c => `${stamp(c.start)} ${c.name}`));
  else lines.push("(Add PART headings to the script to get YouTube chapters: at least 3 are needed.)");
  return lines.join("\n") + "\n";
}
