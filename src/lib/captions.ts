// Captions from the script: the exact words you wrote, timed from the final cut.
import type { Segment } from "./edit";

const MAX = 42; // characters per caption line (the usual broadcast limit)

/** Break a sentence into caption-sized pieces, preferring breaks after punctuation. */
export function chunk(text: string, max = MAX): string[] {
  const words = text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const out: string[] = [];
  let cur: string[] = [];
  const len = (a: string[]) => a.join(" ").length;
  for (const w of words) {
    if (cur.length && len([...cur, w]) > max) {
      // Move back to the last punctuation break if it keeps the piece at least half full.
      let cut = cur.length;
      for (let i = cur.length - 1; i > 0; i--) if (/[,;:—–-]$/.test(cur[i - 1]) && len(cur.slice(0, i)) >= max / 2) { cut = i; break; }
      out.push(cur.slice(0, cut).join(" "));
      cur = cur.slice(cut);
    }
    cur.push(w);
  }
  if (cur.length) out.push(cur.join(" "));
  return out;
}

export interface Cue { start: number; end: number; text: string }

/** Cues for the cut: each segment's sentence, spread over its spoken part by length. */
export function cues(segs: Segment[], sentenceText: (n: number) => string): Cue[] {
  const out: Cue[] = [];
  let t = 0;
  for (const s of segs) {
    const d = s.end - s.start;
    const a = t + Math.min(0.1, d * 0.1), b = t + d - Math.min(0.2, d * 0.1); // skip the cut padding
    const pieces = chunk(sentenceText(s.sentence));
    const total = pieces.reduce((n, p) => n + p.length, 0) || 1;
    let x = a;
    for (const p of pieces) {
      const y = x + ((b - a) * p.length) / total;
      out.push({ start: x, end: y, text: p });
      x = y;
    }
    t += d;
  }
  return out;
}

const stamp = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

export function toSrt(list: Cue[]): string {
  return list.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join("\n");
}
