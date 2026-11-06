/**
 * Read an Excalidraw file (1.x-slides.excalidraw) as a list of slides.
 * Each frame is one slide. ON SCREEN notes in the script are matched to frames in order.
 */

export interface ExElement {
  id: string;
  type: string;
  x: number; y: number; width: number; height: number;
  angle?: number;
  strokeColor?: string; backgroundColor?: string; fillStyle?: string;
  strokeWidth?: number; strokeStyle?: string; roughness?: number; opacity?: number;
  seed?: number;
  roundness?: { type: number } | null;
  points?: [number, number][];
  startArrowhead?: string | null; endArrowhead?: string | null;
  text?: string; fontSize?: number; fontFamily?: number; textAlign?: string; verticalAlign?: string; lineHeight?: number;
  frameId?: string | null;
  isDeleted?: boolean;
  name?: string | null;
}

export interface Frame {
  id: string;
  name: string;
  x: number; y: number; width: number; height: number;
  elements: ExElement[];
  /** All words on the slide, for matching to ON SCREEN notes. */
  words: string;
}

export interface Slides {
  fileName: string;
  frames: Frame[];
}

export function parseSlides(json: string, fileName = "slides.excalidraw"): Slides {
  const data = JSON.parse(json) as { type?: string; elements?: ExElement[] };
  if (!Array.isArray(data.elements)) throw new Error("Not an Excalidraw file");
  // Missing numbers count as 0, as in Excalidraw itself
  const live = data.elements.filter(e => !e.isDeleted).map(e => ({ ...e, x: e.x ?? 0, y: e.y ?? 0, width: e.width ?? 0, height: e.height ?? 0 }));
  let frames = live.filter(e => e.type === "frame" || e.type === "magicframe");
  if (!frames.length && live.length) {
    // No frames: treat the whole drawing as one slide.
    const xs = live.flatMap(e => [e.x, e.x + e.width]), ys = live.flatMap(e => [e.y, e.y + e.height]);
    const x = Math.min(...xs) - 40, y = Math.min(...ys) - 40;
    frames = [{ id: "_all", type: "frame", name: "Drawing", x, y, width: Math.max(...xs) - x + 40, height: Math.max(...ys) - y + 40 }];
    live.forEach(e => (e.frameId = "_all"));
  }
  const out = frames.map((f, i): Frame => {
    const elements = live.filter(e => e.frameId === f.id && e.type !== "frame");
    const text = [f.name ?? "", ...elements.map(e => e.text ?? "")].join(" ");
    return { id: f.id, name: f.name || `Slide ${i + 1}`, x: f.x, y: f.y, width: f.width, height: f.height, elements, words: text };
  });
  // Frames in reading order: by name number if all have one ("01 ..."), else top to bottom, left to right.
  const num = (f: Frame) => Number(f.name.match(/^\s*(\d+)/)?.[1] ?? NaN);
  if (out.every(f => !isNaN(num(f)))) out.sort((a, b) => num(a) - num(b));
  else out.sort((a, b) => a.y - b.y || a.x - b.x);
  return { fileName, frames: out };
}

const STOP = new Set("the and with from that this then each into over one two out are has have its for but not you your gets get labelled small big same".split(" "));
function wordSet(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));
}
function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0; for (const w of a) if (b.has(w)) n++;
  return n / Math.min(a.size, b.size);
}

/**
 * Match ON SCREEN notes (in script order) to frames.
 * Same count: one note per frame, in order. Otherwise: the best in-order match by shared words,
 * so several notes can share a frame and a frame can be skipped.
 */
export function matchNotesToFrames(notes: string[], frames: Frame[]): number[] {
  const n = notes.length, m = frames.length;
  if (!n || !m) return notes.map(() => -1);
  if (n === m) return notes.map((_, i) => i);
  const N = notes.map(wordSet), F = frames.map(f => wordSet(f.words));
  const sim = N.map(a => F.map(b => similarity(a, b)));
  // best[i][j] = best score for notes 0..i with note i on frame j (frames never go backwards)
  const best = Array.from({ length: n }, () => new Array<number>(m).fill(-Infinity));
  const from = Array.from({ length: n }, () => new Array<number>(m).fill(-1));
  for (let j = 0; j < m; j++) best[0][j] = sim[0][j] - j * 0.01;
  for (let i = 1; i < n; i++) {
    let runMax = -Infinity, runArg = -1;
    for (let j = 0; j < m; j++) {
      if (best[i - 1][j] > runMax) { runMax = best[i - 1][j]; runArg = j; }
      best[i][j] = runMax + sim[i][j] - (j - runArg) * 0.01; // small cost for skipping frames
      from[i][j] = runArg;
    }
  }
  let j = best[n - 1].indexOf(Math.max(...best[n - 1]));
  const res = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) { res[i] = j; j = from[i][j]; }
  return res;
}
