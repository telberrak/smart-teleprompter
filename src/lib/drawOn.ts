// Diagrams that draw themselves in, like a whiteboard video.
//
// A slide is split into units (a box with the words inside it, an arrow with the "?" next to it,
// a lone label). Each unit gets a start time: when you say its words ("as said"), or one after
// another in reading order ("quick"). Drawing a unit traces its strokes, then writes its text.
import type { ExElement, Frame } from "./excalidraw";

export type DrawMode = "said" | "quick" | "still";

export interface Unit {
  /** Elements drawn together, in drawing order (shape first, then its text). */
  elements: ExElement[];
  kind: "shape" | "arrow" | "text";
  /** Words that name it (its text), lower case. */
  words: string[];
  box: { x: number; y: number; w: number; h: number };
  /** For arrows: the units at each end, if any. */
  from?: number; to?: number;
}

export interface Planned { unit: Unit; start: number; dur: number }

const STOP = new Set("the and with from that this then each into over one two out are has have its for but not you your gets get a an of to in on is it as at by or be".split(" "));
export const tokens = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));
const stem = (w: string) => w.replace(/(ies|es|s)$/, m => (m === "ies" ? "y" : "")).replace(/'s$/, "");

const center = (e: ExElement) => ({ x: e.x + e.width / 2, y: e.y + e.height / 2 });
const inside = (p: { x: number; y: number }, e: ExElement, pad = 0) => p.x >= e.x - pad && p.x <= e.x + e.width + pad && p.y >= e.y - pad && p.y <= e.y + e.height + pad;
const isShape = (e: ExElement) => e.type === "rectangle" || e.type === "ellipse" || e.type === "diamond";
const ends = (e: ExElement) => {
  const pts = (e.points ?? [[0, 0]]).map(([x, y]) => ({ x: e.x + x, y: e.y + y }));
  return [pts[0], pts[pts.length - 1]];
};
function distToPolyline(p: { x: number; y: number }, e: ExElement) {
  const pts = (e.points ?? []).map(([x, y]) => ({ x: e.x + x, y: e.y + y }));
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/** Split a frame into units, in reading order (top to bottom, left to right). */
export function units(frame: Frame): Unit[] {
  const els = frame.elements;
  const used = new Set<string>();
  const out: Unit[] = [];
  const byId = new Map(els.map(e => [e.id, e]));
  const boxOf = (list: ExElement[]) => {
    const x = Math.min(...list.map(e => e.x)), y = Math.min(...list.map(e => e.y));
    return { x, y, w: Math.max(...list.map(e => e.x + e.width)) - x, h: Math.max(...list.map(e => e.y + e.height)) - y };
  };
  const texts = els.filter(e => e.type === "text");
  // Shapes, with the text that sits inside them (or is bound to them), smallest shape first.
  const shapes = els.filter(isShape).sort((a, b) => a.width * a.height - b.width * b.height);
  for (const s of shapes) {
    const mine = texts.filter(t => !used.has(t.id) && ((t as ExElement & { containerId?: string }).containerId === s.id || inside(center(t), s)));
    // Shapes drawn inside a bigger shape (a database's ellipses) join the bigger one.
    const host = shapes.find(o => o !== s && !used.has(o.id) && o.width * o.height > s.width * s.height && inside(center(s), o, 4) && s.width <= o.width * 1.2);
    if (host && !mine.length) continue; // drawn with its host below
    mine.forEach(t => used.add(t.id));
    used.add(s.id);
    const parts = [s, ...shapes.filter(o => o !== s && !used.has(o.id) && o.width * o.height < s.width * s.height && inside(center(o), s, 4))];
    parts.forEach(p => used.add(p.id));
    const all = [...parts, ...mine];
    out.push({ elements: all, kind: "shape", words: mine.flatMap(t => tokens(t.text ?? "")), box: boxOf(all) });
  }
  // Leftover shapes (inner parts without a host) on their own.
  for (const s of shapes) if (!used.has(s.id)) { used.add(s.id); out.push({ elements: [s], kind: "shape", words: [], box: boxOf([s]) }); }
  // Arrows and lines, with a small label right next to them ("?", "2 ms").
  for (const a of els.filter(e => e.type === "arrow" || e.type === "line" || e.type === "freedraw")) {
    used.add(a.id);
    const near = texts.filter(t => {
      const n = (t.text ?? "").trim().length;
      return !used.has(t.id) && n <= 12 && distToPolyline(center(t), a) < (n <= 3 ? 140 : 50);
    });
    near.forEach(t => used.add(t.id));
    const u: Unit = { elements: [a, ...near], kind: "arrow", words: near.flatMap(t => tokens(t.text ?? "")), box: boxOf([a, ...near]) };
    const bind = a as ExElement & { startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null };
    const [p0, p1] = ends(a);
    const unitAt = (p: { x: number; y: number }, id?: string) => {
      const i = out.findIndex(o => o.kind === "shape" && (id ? o.elements.some(e => e.id === id) : inside(p, { ...o.elements[0], x: o.box.x, y: o.box.y, width: o.box.w, height: o.box.h }, 24)));
      return i >= 0 ? i : undefined;
    };
    u.from = unitAt(p0, bind.startBinding?.elementId && byId.has(bind.startBinding.elementId) ? bind.startBinding.elementId : undefined);
    u.to = unitAt(p1, bind.endBinding?.elementId && byId.has(bind.endBinding.elementId) ? bind.endBinding.elementId : undefined);
    out.push(u);
  }
  for (const t of texts) {
    if (used.has(t.id)) continue;
    // A small mark ("?", "x", "1") belongs to whatever it sits next to.
    if ((t.text ?? "").trim().length <= 3) {
      const c = center(t);
      const gap = (b: Unit["box"]) => Math.hypot(Math.max(b.x - c.x, 0, c.x - (b.x + b.w)), Math.max(b.y - c.y, 0, c.y - (b.y + b.h)));
      const near = out.map((u, i) => ({ i, d: gap(u.box) })).sort((a, b) => a.d - b.d)[0];
      if (near && near.d < 120) { out[near.i].elements.push(t); out[near.i].box = boxOf(out[near.i].elements); used.add(t.id); continue; }
    }
    out.push({ elements: [t], kind: "text", words: tokens(t.text ?? ""), box: boxOf([t]) });
  }
  // Reading order for units that are not arrows; arrows keep their place after their ends.
  return out;
}

/** How long one unit takes to draw, in seconds. */
export function drawTime(u: Unit): number {
  const chars = u.elements.reduce((n, e) => n + (e.text?.length ?? 0), 0);
  const base = u.kind === "arrow" ? 0.5 : u.kind === "text" ? 0.3 : 0.6;
  return Math.min(1.6, base + chars * 0.025);
}

export interface TimedWord { word: string; t: number }

/**
 * When each unit starts drawing, in seconds from `start`.
 * "said": at the first spoken word that names it; arrows when both ends are drawn;
 * the rest fill in, in reading order, between those. "quick": one after another over ~3.5 s.
 */
export function plan(frame: Frame, mode: DrawMode, start: number, end: number, words: TimedWord[] = []): Planned[] {
  const us = units(frame);
  if (!us.length || mode === "still") return us.map(unit => ({ unit, start: start - 10, dur: 0.01 }));
  const order = us.map((u, i) => ({ u, i })).sort((a, b) => (a.u.kind === "arrow" ? 1 : 0) - (b.u.kind === "arrow" ? 1 : 0) || a.u.box.y - b.u.box.y || a.u.box.x - b.u.box.x);
  const span = Math.max(0.5, end - start);
  const t: (number | undefined)[] = new Array(us.length).fill(undefined);
  if (mode === "quick") {
    const total = Math.min(3.5, span * 0.6), step = total / Math.max(1, order.length);
    order.forEach(({ i }, k) => (t[i] = start + k * step));
  } else {
    // Said: first mention of any of the unit's words, after the slide is up.
    // Only mentions soon after the slide comes up: a word said much later is a callback, not the intro.
    const window = Math.max(12, Math.min(30, span * 0.5));
    const spoken = words.filter(w => w.t >= start - 0.05 && w.t < Math.min(end, start + window)).map(w => ({ ...w, s: stem(w.word) }));
    us.forEach((u, i) => {
      if (u.kind === "arrow" && !u.words.some(w => w.length > 2)) return;
      // A label of several words is named by its last one ("Orders database" → "database"),
      // so "for a second" does not draw "Second region".
      const ws = u.words.map(stem).filter(w => w.length > 2);
      const want = new Set(ws.length > 1 ? [ws[ws.length - 1]] : ws);
      const hit = spoken.find(w => want.has(w.s));
      // Starts drawing as the word is said (never before), so the box appears as you name it.
      if (hit) t[i] = Math.max(start, hit.t);
    });
    // The slide's title (the topmost text) is up from the start.
    const title = order.find(({ u }) => u.kind === "text");
    if (title && title.u.box.y <= Math.min(...us.map(u => u.box.y)) + 1) t[title.i] = start;
    // Boxes an arrow leads to: after the box it leaves, one by one (top to bottom), each arrow first.
    for (let pass = 0; pass < 4; pass++) {
      const bySource = new Map<number, number[]>();
      us.forEach((u, i) => {
        if (u.kind !== "arrow" || u.from === undefined || u.to === undefined || t[u.from] === undefined || t[u.to] !== undefined) return;
        bySource.set(u.from, [...(bySource.get(u.from) ?? []), u.to]);
      });
      if (!bySource.size) break;
      for (const [src, targets] of bySource) {
        [...new Set(targets)].sort((x, y) => us[x].box.y - us[y].box.y || us[x].box.x - us[y].box.x)
          .forEach((j, k) => (t[j] = t[src]! + drawTime(us[src]) + 0.4 + k * 0.9));
      }
    }
    // Other unnamed units: spread out between their timed neighbours in reading order.
    const nonArrows = order.filter(({ u }) => u.kind !== "arrow");
    let prev = start;
    for (let k = 0; k < nonArrows.length;) {
      if (t[nonArrows[k].i] !== undefined) { prev = Math.max(prev, t[nonArrows[k].i]!); k++; continue; }
      let m = k; while (m < nonArrows.length && t[nonArrows[m].i] === undefined) m++;
      const run = m - k, next = m < nonArrows.length ? t[nonArrows[m].i]! : undefined;
      const stepT = next !== undefined && next > prev ? Math.min(0.9, (next - prev) / (run + 1)) : 0.7;
      for (let j = 0; j < run; j++) t[nonArrows[k + j].i] = prev + stepT * (j + 1);
      prev = t[nonArrows[m - 1].i]!;
      k = m;
    }
    // Arrows: drawn just before the box they point to, else after the box they leave.
    us.forEach((u, i) => {
      if (u.kind !== "arrow" || t[i] !== undefined) return;
      const a = u.from !== undefined ? t[u.from]! + drawTime(us[u.from]) * 0.8 : undefined;
      const b = u.to !== undefined ? t[u.to]! - drawTime(u) * 0.9 : undefined;
      t[i] = b !== undefined ? (a !== undefined ? Math.max(a - 0.3, b) : b) : a ?? start + 0.6;
    });
  }
  return us.map((unit, i) => ({ unit, start: Math.min(end - 0.2, Math.max(start, t[i] ?? start)), dur: drawTime(unit) }));
}

type Piece = { type: "word"; text: string } | { type: "breath" } | { type: "pause"; secs: number };

/**
 * Words of the sentences spoken while a slide is up, with when each is said (cut time).
 * Each word takes time by its length; a breath mark "/" or a [pause] inside the sentence is a short
 * gap, so words after it are placed later (as you actually say them).
 */
export function timedWords(segs: { sentence: number; start: number; end: number }[], spoken: (n: number) => string | Piece[]): TimedWord[] {
  const out: TimedWord[] = [];
  let t = 0;
  for (const s of segs) {
    const d = s.end - s.start;
    const a = t + Math.min(0.15, d * 0.1), b = t + d - Math.min(0.25, d * 0.1);
    const src = spoken(s.sentence);
    const pieces: Piece[] = typeof src === "string" ? src.split(/\s+/).filter(Boolean).map(text => ({ type: "word", text })) : src;
    // Drop gaps at the very end (the cut trims trailing silence).
    while (pieces.length && pieces[pieces.length - 1].type !== "word") pieces.pop();
    const words = pieces.filter((x): x is Extract<Piece, { type: "word" }> => x.type === "word");
    const chars = words.reduce((n, w) => n + w.text.length + 1, 0) || 1;
    // Gaps inside the sentence: a breath ~0.3 s, a pause its length, together at most a third of the sentence.
    const gapsRaw = pieces.reduce((n, x) => n + (x.type === "breath" ? 0.3 : x.type === "pause" ? Math.min(x.secs, 1.5) : 0), 0);
    const gapK = gapsRaw > 0 ? Math.min(1, ((b - a) / 3) / gapsRaw) : 0;
    const talk = Math.max(0.1, b - a - gapsRaw * gapK);
    let x = a;
    for (const pc of pieces) {
      if (pc.type === "word") {
        for (const tok of tokens(pc.text)) out.push({ word: tok, t: x });
        x += (talk * (pc.text.length + 1)) / chars;
      } else x += (pc.type === "breath" ? 0.3 : Math.min(pc.secs, 1.5)) * gapK;
    }
    t += d;
  }
  return out;
}

/** Is anything still drawing at time t? */
export const busyAt = (p: Planned[], t: number) => p.some(x => t >= x.start && t < x.start + x.dur);
/** The time after which the slide no longer changes. */
export const doneAt = (p: Planned[]) => Math.max(0, ...p.map(x => x.start + x.dur));
