// The vertical Short: up to 60 s of the lesson's best sentences, laid out 9:16 with big captions.
import type { Segment } from "./edit";
import type { Script, Sentence } from "./script";
import { chunk, type Cue } from "./captions";
import { stepAt } from "./storyboard";

export const SHORT_MAX = 60;
/** Short captions: a few words at a time, read at a glance. */
export const SHORT_CHARS = 22;

export interface ShortPiece {
  sentence: number;
  /** Where it sits in the cut, in seconds. */
  from: number;
  to: number;
  /** Slide shown with it (0 = camera only). */
  step: number;
}

/** Each segment's place in the cut. */
function times(segs: Segment[]) {
  let t = 0;
  return segs.map(s => { const row = { sentence: s.sentence, from: t, to: t + (s.end - s.start) }; t = row.to; return row; });
}

/** How much a sentence carries on its own: stressed words, key or definition lines, plain explanations. */
export function sentenceScore(s: Sentence | undefined): number {
  if (!s) return 0;
  const stressed = s.tokens.filter(t => t.type === "word" && t.stress).length;
  let score = Math.min(4, stressed) * 1.5;
  if (s.kind === "key" || s.kind === "def") score += 3;
  if (s.kind === "intro") score += 1;
  if (/\?$/.test(s.spoken.trim())) score += 1;
  if (/\b(is|means|think of|imagine|the (trick|point|key|reason)|because|so)\b/i.test(s.spoken)) score += 1.5;
  if (/\b(as I said|earlier|last lesson|next lesson|in this lesson|subscribe)\b/i.test(s.spoken)) score -= 3;
  return score;
}

/**
 * Suggested sentences: the opening line as the hook, then the stretch of the lesson
 * that packs the most into the time left (a passage, not scattered lines, so it makes sense alone).
 */
export function suggestShort(segs: Segment[], script: Script, max = SHORT_MAX - 2): number[] {
  const rows = times(segs);
  if (!rows.length) return [];
  const sc = rows.map(r => sentenceScore(script.sentences[r.sentence - 1]));
  const hook = rows[0].to - rows[0].from <= 12 ? 0 : -1;
  const room = max - (hook === 0 ? rows[0].to - rows[0].from : 0);
  let best = { a: -1, b: -1, score: -Infinity };
  for (let a = hook === 0 ? 1 : 0; a < rows.length; a++) {
    let d = 0, s = 0;
    for (let b = a; b < rows.length; b++) {
      d += rows[b].to - rows[b].from;
      if (d > room) break;
      s += sc[b];
      // Prefer fuller Shorts a little, so a short burst of keywords does not win over a whole idea.
      const score = s + d * 0.05;
      if (score > best.score) best = { a, b, score };
    }
  }
  const out = hook === 0 ? [rows[0].sentence] : [];
  if (best.a >= 0) for (let i = best.a; i <= best.b; i++) out.push(rows[i].sentence);
  return out;
}

/** The pieces of the cut that make the Short, in lesson order. */
export function shortPieces(segs: Segment[], script: Script, picks: number[], hasCamera = true): ShortPiece[] {
  const want = new Set(picks);
  const firstStep = script.sentences.find(s => s.step)?.step ?? 0;
  return times(segs).filter(r => want.has(r.sentence)).map(r => {
    let step = stepAt(script, r.sentence);
    if (!hasCamera && step === 0) step = firstStep;
    return { ...r, step };
  });
}

export const shortSeconds = (pieces: ShortPiece[]) => +pieces.reduce((a, p) => a + (p.to - p.from), 0).toFixed(3);

/** Captions on the Short's own clock: two or three words at a time. */
export function shortCues(pieces: ShortPiece[], text: (n: number) => string): Cue[] {
  const out: Cue[] = [];
  let t = 0;
  for (const p of pieces) {
    const d = p.to - p.from;
    const a = t + Math.min(0.1, d * 0.1), b = t + d - Math.min(0.2, d * 0.1);
    const parts = chunk(text(p.sentence), SHORT_CHARS);
    const total = parts.reduce((n, x) => n + x.length, 0) || 1;
    let x = a;
    for (const part of parts) { const y = x + ((b - a) * part.length) / total; out.push({ start: x, end: y, text: part }); x = y; }
    t += d;
  }
  return out;
}

const assTime = (s: number) => {
  const cs = Math.max(0, Math.round(s * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor((cs % 360000) / 6000)).padStart(2, "0")}:${String(Math.floor((cs % 6000) / 100)).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
/** ASS colour from #rrggbb (ASS is &HAABBGGRR). */
const assColour = (hex: string) => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  return m ? `&H00${m[3]}${m[2]}${m[1]}`.toUpperCase() : "&H0060B8F4";
};

/**
 * Captions as an ASS file sized for 1080x1920, so the size and place are exact:
 * big bold words with a thick outline, the stressed words in the accent colour.
 * `y` is the caption's baseline from the top, at a time in the Short.
 */
export function shortAss(list: Cue[], opts: { accent: string; y: number | ((t: number) => number); stressed?: Set<string> }): string {
  const yAt = typeof opts.y === "number" ? () => opts.y as number : opts.y;
  const marginV = (t: number) => Math.round(1920 - yAt(t));
  const acc = assColour(opts.accent);
  const esc = (s: string) => s.replace(/[{}\\]/g, "");
  const line = (text: string) => esc(text).split(" ").map(w => (opts.stressed?.has(w.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "")) ? `{\\c${acc}}${w}{\\c&H00FFFFFF&}` : w)).join(" ");
  return [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Short,Arial,84,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,7,2,2,70,70,300,1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...list.map(c => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Short,,0,0,${marginV((c.start + c.end) / 2)},,${line(c.text)}`),
    "",
  ].join("\n");
}

/** The stressed words of the picked sentences, for the accent colour in the captions. */
export function stressedWords(script: Script, picks: number[]): Set<string> {
  const out = new Set<string>();
  for (const n of picks) for (const t of script.sentences[n - 1]?.tokens ?? [])
    if (t.type === "word" && t.stress) out.add(t.text.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, ""));
  out.delete("");
  return out;
}

/** Where things sit on the 1080x1920 frame, per kind of piece. */
export const SHORT_LAYOUT = {
  slide: { x: 20, y: 280, w: 1040, h: 585 },
  /** Camera under the slide. */
  camera: { y: 1030, h: 890 },
  /** Caption baseline: between slide and face; lower on a camera-only or slide-only piece. */
  captionY: { both: 990, camera: 1450, slide: 1300 },
} as const;

export type PieceLayout = "both" | "camera" | "slide";
export const pieceLayout = (p: ShortPiece, hasCamera: boolean): PieceLayout => (!hasCamera ? "slide" : p.step ? "both" : "camera");

/** Caption baseline at time t of the Short. */
export function captionYAt(pieces: ShortPiece[], hasCamera: boolean) {
  return (t: number) => {
    let x = 0;
    for (const p of pieces) { const d = p.to - p.from; if (t < x + d) return SHORT_LAYOUT.captionY[pieceLayout(p, hasCamera)]; x += d; }
    return SHORT_LAYOUT.captionY.both;
  };
}
