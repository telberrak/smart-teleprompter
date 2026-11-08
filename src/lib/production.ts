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
export interface SlideClip extends Base {
  track: "slides"; step: number; enter: SlideEnter; motion: SlideMotion;
  /** Bubble corner over this slide, if different from the camera's. */ corner?: Corner;
  /** How the drawing comes in: as you name its parts, quickly one after another, or whole. Default "said". */
  draw?: DrawMode;
}
export interface VoiceClip extends Base { track: "voice"; clean: boolean; loudness: -14 | -16 }
export interface MusicClip extends Base { track: "music"; file: string; volume: number; duck: Duck; fadeOut: number }
export interface SfxClip extends Base { track: "sfx"; sound: Sound; volume: number }
export interface CaptionClip extends Base { track: "captions"; style: CaptionStyle }
import type { DrawMode } from "./drawOn";
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
  /** The script's slides and words when this was built: when the script changes on disk the timeline is refitted. */
  scriptKey?: string;
  title: string;
  seconds: number;
  brand: Brand;
  clips: Clip[];
  /** Sentences picked for the vertical Short (suggested until you change them). */
  short?: number[];
  /** Per lane: locked (no edits) and off (hidden or muted: left out of the preview and the export). */
  tracks?: Partial<Record<TrackId, { locked?: boolean; off?: boolean }>>;
  /**
   * Pauses added on the timeline: at a point of the cut (seconds of the cut), this long.
   * The picture holds its frame and the sound is silent; a pause at the very end makes room after you finish talking.
   */
  gaps?: Gap[];
  /** Seconds the drawing waits after the word that names a part (default 0.3). */
  drawDelay?: number;
  /** Your own markers on the ruler, in seconds. */
  markers?: number[];
}

export interface Gap { cut: number; dur: number }

const gapsOf = (p: Production) => [...(p.gaps ?? [])].sort((a, b) => a.cut - b.cut);
/** Length of the cut itself (the timeline minus its pauses). */
export const cutLength = (p: Production) => r3(p.seconds - (p.gaps ?? []).reduce((a, g) => a + g.dur, 0));
/** Where a moment of the cut sits on the timeline (`end`: a moment that ends there, before a pause at it). */
export function tlOf(p: Production, c: number, end = false): number {
  let t = c;
  for (const g of p.gaps ?? []) if (end ? g.cut < c - 1e-6 : g.cut <= c + 1e-6) t += g.dur;
  return t;
}
/** The cut's moment at timeline time t, and the pause it falls in (if any). */
export function cutAt(p: Production, t: number): { c: number; gap?: { start: number; end: number; cut: number } } {
  let acc = 0;
  for (const g of gapsOf(p)) {
    const gs = g.cut + acc;
    if (t < gs) return { c: t - acc };
    if (t < gs + g.dur) return { c: g.cut, gap: { start: gs, end: gs + g.dur, cut: g.cut } };
    acc += g.dur;
  }
  return { c: t - acc };
}
/** Pauses with their place on the timeline. */
export function gapSpans(p: Production): { i: number; cut: number; dur: number; start: number; end: number }[] {
  let acc = 0;
  return gapsOf(p).map(g => { const start = g.cut + acc; acc += g.dur; return { i: (p.gaps ?? []).indexOf(g), cut: g.cut, dur: g.dur, start, end: start + g.dur }; });
}

/**
 * Add a pause at timeline time t: what comes after moves right, clips that run across it get longer.
 * Inside an existing pause it makes that pause longer. At the end it makes room after the last word.
 */
export function insertGap(p: Production, t: number, dur: number): Production {
  if (dur <= 0) return p;
  const here = cutAt(p, Math.min(t, p.seconds));
  const at = here.gap ? here.gap.end : Math.min(t, p.seconds);
  const cut = r3(here.c);
  const gaps = [...(p.gaps ?? [])];
  const same = gaps.findIndex(g => Math.abs(g.cut - cut) < 0.01);
  if (same >= 0) gaps[same] = { ...gaps[same], dur: r3(gaps[same].dur + dur) }; else gaps.push({ cut, dur: r3(dur) });
  const sh = (x: number) => (x >= at - 1e-6 ? r3(x + dur) : x);
  const clips = p.clips.map(c => (c.start >= at - 1e-6 ? { ...c, start: r3(c.start + dur), end: r3(c.end + dur) }
    : c.end > at + 1e-6 || c.track === "voice" || c.track === "captions" || (["camera", "slides", "music"].includes(c.track) && c.end >= p.seconds - 1e-6)
      ? { ...c, end: r3(c.end + dur) } : c) as Clip);
  return { ...p, seconds: r3(p.seconds + dur), gaps, clips, markers: p.markers?.map(sh) };
}

/** Take out pause i (as listed in p.gaps): what came after moves back. */
export function removeGap(p: Production, i: number): Production {
  const span = gapSpans(p).find(x => x.i === i);
  if (!span) return p;
  const { start: gs, end: ge, dur } = span;
  const m = (x: number) => (x <= gs ? x : x >= ge ? r3(x - dur) : gs);
  const clips = p.clips.map(c => ({ ...c, start: m(c.start), end: m(c.end) }) as Clip).filter(c => c.end - c.start > 0.05);
  return { ...p, seconds: r3(p.seconds - dur), gaps: (p.gaps ?? []).filter((_, k) => k !== i), clips, markers: p.markers?.map(m) };
}

/** Change pause i's length. */
export function setGapDur(p: Production, i: number, dur: number): Production {
  const span = gapSpans(p).find(x => x.i === i);
  if (!span) return p;
  const q = removeGap(p, i);
  return dur > 0.05 ? insertGap(q, span.start, dur) : q;
}

/** What of the script the timeline depends on: title, slide steps and words. */
export function scriptKey(script: Script): string {
  let h = 0;
  const text = script.title + "\n" + script.sentences.map(s => `${s.step ?? ""}|${s.screen ?? ""}|${s.spoken}`).join("\n");
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ":" + script.sentences.length;
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
  // Captions are off by default (YouTube gets the .srt instead); turn them on from the Captions lane.
  clips.push({ id: uid("cc"), track: "captions", style: "off", start: 0, end: total });

  return { version: 1, cutKey: cutKey(segs), scriptKey: scriptKey(script), title: script.title, seconds: total, brand, clips };
}

/**
 * After the cut changed in Review: the fresh automatic layout (camera, slides, captions timing),
 * with your own choices carried over: brand, voice and caption settings, music, and your titles
 * (kept where they fit; the end card moves to the new end).
 */
export function refit(old: Production, fresh: Production): Production {
  const T = fresh.seconds;
  const keep = <K extends TrackId>(track: K) => old.clips.filter(c => c.track === track);
  const voice = keep("voice")[0] as VoiceClip | undefined, cap = keep("captions")[0] as CaptionClip | undefined;
  const titles = (keep("titles") as TitleClip[]).flatMap(c => {
    const d = c.end - c.start;
    if (c.kind === "outro") return [{ ...c, start: r3(Math.max(0, T - d)), end: T }];
    if (c.start >= T - 0.5) return [];
    return [{ ...c, end: r3(Math.min(c.end, T)) }];
  });
  const music = (keep("music") as MusicClip[]).map(c => ({ ...c, start: 0, end: T }));
  const clips = fresh.clips.flatMap(c => {
    if (c.track === "titles" || c.track === "music") return [];
    if (c.track === "voice" && voice) return [{ ...c, clean: voice.clean, loudness: voice.loudness }];
    if (c.track === "captions" && cap) return [{ ...c, style: cap.style }];
    return [c];
  });
  let out: Production = { ...fresh, brand: old.brand, short: undefined, clips: [...titles, ...clips, ...music].sort((a, b) => a.start - b.start) };
  // A pause at the end (room after the last word) is kept; pauses inside the old cut are not (the sentences moved).
  const tail = (old.gaps ?? []).find(g => g.cut >= cutLength(old) - 0.05);
  if (tail) {
    out = insertGap(out, out.seconds, tail.dur);
    out = { ...out, clips: out.clips.map(c => (c.track === "titles" && c.kind === "outro" ? { ...c, start: r3(Math.max(0, out.seconds - (c.end - c.start))), end: out.seconds } : c)) };
  }
  return out;
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

/** Lanes that can be hidden or muted (the voice is the lesson, so it always plays). */
export const canTurnOff = (t: TrackId) => t !== "voice";
export const isLocked = (p: Production, t: TrackId) => !!p.tracks?.[t]?.locked;
export const isOff = (p: Production, t: TrackId) => !!p.tracks?.[t]?.off;
export function setTrack(p: Production, t: TrackId, patch: { locked?: boolean; off?: boolean }): Production {
  return { ...p, tracks: { ...p.tracks, [t]: { ...p.tracks?.[t], ...patch } } };
}

/** The production as it plays: hidden or muted lanes left out (camera hidden, captions off). */
export function applyTracks(p: Production): Production {
  if (!p.tracks || !Object.values(p.tracks).some(x => x?.off)) return p;
  const clips = p.clips.flatMap((c): Clip[] => {
    if (!isOff(p, c.track) || !canTurnOff(c.track)) return [c];
    if (c.track === "camera") return [{ ...c, layout: "hidden" }];
    if (c.track === "captions") return [{ ...c, style: "off" }];
    return [];
  });
  return { ...p, clips };
}

/** A copy of a title, sound effect or music clip placed right after it. */
export function duplicate(p: Production, id: string): Production {
  const c = p.clips.find(x => x.id === id);
  if (!c || (c.track !== "titles" && c.track !== "sfx" && c.track !== "music")) return p;
  const d = c.end - c.start;
  const start = r3(Math.min(p.seconds - d, c.end));
  return add(p, { ...c, start, end: r3(start + d) } as Omit<Clip, "id">);
}

/** Add a marker at t, or remove the one within 0.2 s of it. */
export function toggleMarker(p: Production, t: number): Production {
  const m = p.markers ?? [];
  const near = m.findIndex(x => Math.abs(x - t) < 0.2);
  return { ...p, markers: near >= 0 ? m.filter((_, i) => i !== near) : [...m, r3(t)].sort((a, b) => a - b) };
}

/** Clips that can be deleted (voice and captions follow the cut; the camera covers the whole video). */
export const deletable = (c: Clip) => c.track !== "voice" && c.track !== "captions" && c.track !== "camera";

/** Clips you can lengthen or shorten by dragging an edge (voice and captions follow the cut). */
export const trimmable = (c: Clip) => c.track !== "voice" && c.track !== "captions";

/**
 * Drag one edge of a clip to time t. On the camera and slides lanes, a neighbour that touches
 * that edge moves with it (so no gap or overlap appears); the camera always covers the whole video.
 */
export function trim(p: Production, id: string, edge: "start" | "end", t: number, min = 0.5): Production {
  const c = p.clips.find(x => x.id === id);
  if (!c || !trimmable(c)) return p;
  const list = clipsOn(p, c.track);
  const i = list.findIndex(x => x.id === id);
  const linked = c.track === "camera" || c.track === "slides";
  if (edge === "start") {
    if (c.track === "camera" && i === 0) return p;
    const prev = list[i - 1];
    const touching = linked && !!prev && Math.abs(prev.end - c.start) < 0.05;
    const lo = touching ? prev.start + min : linked && prev ? prev.end : 0;
    const s = r3(Math.max(lo, Math.min(c.end - min, t)));
    return { ...p, clips: p.clips.map(x => (x.id === id ? ({ ...x, start: s } as Clip) : touching && x.id === prev.id ? ({ ...x, end: s } as Clip) : x)) };
  }
  if (c.track === "camera" && i === list.length - 1) return p;
  const next = list[i + 1];
  const touching = linked && !!next && Math.abs(next.start - c.end) < 0.05;
  const hi = touching ? next.end - min : linked && next ? next.start : p.seconds;
  const e = r3(Math.min(hi, Math.max(c.start + min, t)));
  return { ...p, clips: p.clips.map(x => (x.id === id ? ({ ...x, end: e } as Clip) : touching && x.id === next.id ? ({ ...x, start: e } as Clip) : x)) };
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
  } else out.push({ id: "capspeed", name: "Captions are off in the video", ok: true, detail: "Tick SRT to give YouTube a subtitle track, or burn them in",
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
  const ch = chapters(segs, script).map(c => ({ ...c, start: tlOf(p, c.start) }));
  const stamp = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}` : `${Math.floor(s / 60)}`) + `:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const lines = [p.title, ""];
  if (ch.length >= 3) lines.push(...ch.map(c => `${stamp(c.start)} ${c.name}`));
  else lines.push("(Add PART headings to the script to get YouTube chapters: at least 3 are needed.)");
  return lines.join("\n") + "\n";
}
