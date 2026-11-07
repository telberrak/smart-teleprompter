// Voice following: find where in the script the speaker is, from a rough live transcript.
//
// whisper.cpp hears the last few seconds of audio again and again. Each time, we take the
// last words it heard and line them up (local alignment, fuzzy word matching) against the
// script near the current position. The best alignment's last script word is "where you are".

const NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

/** Lower case, letters and digits only; small numbers spelled out so "3" matches "three". */
export function norm(word: string): string {
  const w = word.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]/g, "");
  return /^\d+$/.test(w) && +w <= 20 ? NUMBERS[+w] : w;
}

/** Split a transcript into normalised words, dropping whisper's [BLANK_AUDIO]-style tags. */
export function heardWords(text: string): string[] {
  return text.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").split(/[\s\-–—/]+/).map(norm).filter(Boolean);
}

function lev(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** How alike two normalised words are, 0..1. */
export function similar(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  return 1 - lev(a, b) / Math.max(a.length, b.length);
}

export interface AlignOptions {
  /** How far back from the current position to look (words). */
  back?: number;
  /** How far ahead to look (words). */
  ahead?: number;
  /** Only the last this-many heard words are used. */
  tail?: number;
  /** Minimum alignment score to move (a clean match scores 2 per word). */
  minScore?: number;
}

export interface AlignResult { pos: number; score: number }

/**
 * Where is the speaker? `script` holds the script's normalised words, `pos` is the index of
 * the last word already said (-1 before the start), `heard` the normalised words just heard.
 * Returns the index of the script word that matches the end of what was heard, or null when
 * nothing matches well enough (silence, ad-libbing, noise).
 */
export function align(script: string[], pos: number, heard: string[], o: AlignOptions = {}): AlignResult | null {
  const back = o.back ?? 30, ahead = o.ahead ?? 60, tail = o.tail ?? 12, minScore = o.minScore ?? 4;
  const h = heard.slice(-tail);
  if (!h.length || !script.length) return null;
  const lo = Math.max(0, pos - back), hi = Math.min(script.length, pos + 1 + ahead);
  const win = script.slice(lo, hi);
  const MATCH = 2, NEAR = 1, MISS = -1, GAP = -1;

  // Smith-Waterman: H[i][j] = best score of an alignment ending at heard i, script word j.
  let prev = new Array(win.length + 1).fill(0);
  let best: AlignResult | null = null;
  for (let i = 1; i <= h.length; i++) {
    const cur = new Array(win.length + 1).fill(0);
    for (let j = 1; j <= win.length; j++) {
      const s = similar(h[i - 1], win[j - 1]);
      const m = s >= 0.8 ? MATCH : s >= 0.6 ? NEAR : MISS;
      cur[j] = Math.max(0, prev[j - 1] + m, prev[j] + GAP, cur[j - 1] + GAP);
      // Only alignments that reach (almost) the newest heard word say where we are now.
      // The end cell must itself be a match, so "where we are" is a word actually heard.
      if (i >= h.length - 1 && m > 0) {
        const at = lo + j - 1;
        const dist = at - pos;
        // Prefer the nearest place: small cost for jumping far ahead, more for going back.
        const score = cur[j] - (dist >= 0 ? dist * 0.02 : -dist * 0.15);
        if (!best || score > best.score) best = { pos: at, score };
      }
    }
    prev = cur;
  }
  if (!best || best.score < minScore) return null;
  // Going backwards needs strong evidence (you really did go back to re-say a line).
  if (best.pos < pos && best.score < 8) return null;
  return best;
}
