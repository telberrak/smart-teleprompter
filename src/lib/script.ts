/**
 * Parser for whiteboard scripts (1.x-whiteboard-script.md).
 *
 * Markup understood:
 *   **Title**  or  # Title    first line = video title
 *   (About 12 minutes ...)    meta lines in parentheses are skipped
 *   Bold = stress. / = ...    the legend line is skipped
 *   === PART 1. COLD OPEN ===  section header (also ## headings)
 *   [ON SCREEN: free text]    one diagram step per note, numbered in order; hidden from the prompter
 *   [ON SCREEN: step 3]       explicit step number
 *   [pause] [long pause] [pause 2s]   1 s, 2.5 s, or the given seconds after the previous sentence
 *   /                         breath mark (0.3 s)
 *   **words, even / several** stressed words (can span several words)
 *   {intro|key|def|ex|tr}     optional colour tag; without tags sentences alternate navy / orange
 *
 * Sentences end as in colour_sentences.py: at a word ending in . ? or ! (plus an optional closing
 * quote, or a closing **). Pause marks stay with the sentence before them; a sentence may run across lines.
 */

export type Kind = "intro" | "key" | "def" | "ex" | "tr" | "a" | "b" | "plain";

export type Token =
  | { type: "word"; text: string; stress: boolean }
  | { type: "breath" }
  | { type: "pause"; secs: number; long: boolean };

export interface Sentence {
  index: number;
  kind: Kind;
  /** Sentence text as written in the file, markup included (without the {kind} tag). */
  source: string;
  /** Plain spoken text, for captions and matching. */
  spoken: string;
  tokens: Token[];
  section?: string;
  /** Diagram step shown when this sentence starts. */
  step?: number;
  /** The ON SCREEN note for that step, if it was free text. */
  screen?: string;
  notes: string[];
  /** Total of the [pause] marks inside or after this sentence, in seconds. */
  pause?: number;
}

export interface Script {
  title: string;
  sentences: Sentence[];
  sections: string[];
  /** Reading speed from the script's own note ("timed at 228 spoken words per minute"), default 150. */
  wpm: number;
  /** true when the script uses {kind} tags; otherwise colours alternate. */
  tagged: boolean;
}

const NOTE_RE = /^\[\s*ON\s+SCREEN\s*:?\s*([\s\S]*)\]$/i;
const PAUSE_RE = /^\[\s*(long\s+)?pause(?:\s+(\d+(?:\.\d+)?)\s*s?)?\s*\]$/i;
const KIND_RE = /^\{(intro|key|def|ex|tr)\}$/i;
/**
 * Same rule as colour_sentences.py: a word ending in . ? or ! (plus an optional closing quote) ends the sentence.
 * One difference: a closing ** after the punctuation also ends it, so a bold line like **"How did ...?"** is its own sentence.
 */
const END_RE = /[.?!]["”]?(\*\*)?$/;
export const LONG_PAUSE = 2.5;
export const BREATH = 0.3;

/** Split raw text into tokens, keeping [bracket markers] whole. */
function rawTokens(text: string): string[] {
  return text.match(/\[[^\]]*\]|\S+/g) ?? [];
}

/** Split text into sentences with the colour_sentences.py rule. Used for tests and tools. */
export function splitSentences(text: string): string[] {
  return parseScript("# x\n" + text).sentences.map(s => s.source);
}

/** Tokenize one sentence's source. `bold` carries a **stress** span that started earlier. */
export function tokenize(src: string, bold = false): { tokens: Token[]; bold: boolean } {
  const tokens: Token[] = [];
  for (const raw of rawTokens(src)) {
    const t = toToken(raw, bold);
    bold = t.bold;
    if (t.token) tokens.push(t.token);
  }
  return { tokens, bold };
}

function toToken(raw: string, bold: boolean): { token?: Token; bold: boolean } {
  if (raw === "/" || raw === "//") return { token: { type: "breath" }, bold };
  const p = raw.match(PAUSE_RE);
  if (p) {
    const secs = p[2] ? Number(p[2]) : p[1] ? LONG_PAUSE : 1;
    return { token: { type: "pause", secs, long: !!p[1] }, bold };
  }
  const marks = (raw.match(/\*\*/g) || []).length;
  const stress = bold || marks > 0;
  if (marks % 2 === 1) bold = !bold;
  const text = raw.replace(/\*\*/g, "");
  return { token: text ? { type: "word", text, stress } : undefined, bold };
}

export function parseScript(md: string): Script {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let title = "";
  let wpm = 150;
  const tagged = /\{(intro|key|def|ex|tr)\}/i.test(md);
  const sections: string[] = [];
  const sentences: Sentence[] = [];
  let section: string | undefined;
  let pendingStep: number | undefined;
  let pendingScreen: string | undefined;
  let autoStep = 0;
  let bold = false;
  let kind: Kind = "plain";

  // The sentence being built. Like colour_sentences.py, a sentence can run across lines,
  // and pause marks after its last word stay with it until the next word starts a new one.
  let cur: { raw: string[]; tokens: Token[]; section?: string; step?: number; screen?: string; kind: Kind } | null = null;
  let ended = false;

  const finish = () => {
    if (!cur) return;
    const words = cur.tokens.filter((t): t is Extract<Token, { type: "word" }> => t.type === "word");
    if (words.length) {
      const pause = cur.tokens.reduce((a, t) => a + (t.type === "pause" ? t.secs : 0), 0);
      sentences.push({
        index: sentences.length,
        kind: tagged ? cur.kind : sentences.length % 2 === 0 ? "a" : "b",
        source: cur.raw.join(" "),
        spoken: words.map(w => w.text).join(" "),
        tokens: cur.tokens,
        section: cur.section,
        step: cur.step,
        screen: cur.screen,
        notes: [],
        pause: pause || undefined,
      });
    }
    cur = null; ended = false;
  };

  let seenTitle = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (!seenTitle) {
      seenTitle = true;
      const h = t.match(/^#\s+(.+)$/) || t.match(/^\*\*(.+)\*\*$/);
      if (h) { title = h[1].trim(); continue; }
    }
    if (/^\(.*\)$/.test(t)) {
      const w = t.match(/(\d+)\s+(?:spoken\s+)?words\s+per\s+minute/i);
      if (w) wpm = Number(w[1]);
      continue;
    }
    if (/^bold\s*=/i.test(t)) continue;
    const sec = t.match(/^={2,}\s*(.+?)\s*={2,}$/) || t.match(/^#{1,6}\s+(.+)$/) || t.match(/^-{3}\s*(.+?)\s*-{3}$/);
    if (sec) {
      finish();
      section = sec[1].replace(/^PART\s+\d+\.\s*/i, "");
      sections.push(section);
      continue;
    }
    for (const raw of rawTokens(t)) {
      const note = raw.match(NOTE_RE);
      if (note) {
        const body = note[1].trim();
        const explicit = body.match(/^step\s*(\d+)\s*$/i);
        if (explicit) { pendingStep = Number(explicit[1]); autoStep = pendingStep; pendingScreen = undefined; }
        else if (body && body !== "…") { pendingStep = ++autoStep; pendingScreen = body; }
        continue;
      }
      const k = raw.match(KIND_RE);
      if (k) { kind = k[1].toLowerCase() as Kind; continue; }
      const { token, bold: b } = toToken(raw, bold);
      bold = b;
      if (!token) continue;
      if (token.type === "word") {
        if (ended || !cur) {
          finish();
          cur = { raw: [], tokens: [], section, kind, step: pendingStep, screen: pendingScreen };
          pendingStep = undefined; pendingScreen = undefined;
        }
        cur.raw.push(raw);
        cur.tokens.push(token);
        if (END_RE.test(raw)) ended = true;
      } else if (cur) {
        cur.raw.push(raw);
        cur.tokens.push(token);
      }
    }
  }
  finish();

  return { title: title || "Untitled script", sentences, sections, wpm, tagged };
}

/** Replace one sentence's text in the original markdown, keeping every other byte. */
export function replaceSentence(md: string, oldSource: string, newSource: string): string {
  const at = md.indexOf(oldSource);
  if (at >= 0) return md.slice(0, at) + newSource + md.slice(at + oldSource.length);
  // The sentence may span a line break in the file: match with flexible whitespace.
  const pattern = new RegExp(oldSource.split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"));
  const m = md.match(pattern);
  if (!m || m.index === undefined) throw new Error("Sentence not found in script file");
  return md.slice(0, m.index) + newSource + md.slice(m.index + m[0].length);
}

export function wordCount(s: Script): number {
  return s.sentences.reduce((a, x) => a + x.tokens.filter(t => t.type === "word").length, 0);
}

/** Estimated reading time in seconds at the script's pace, including pauses and breaths. */
export function estimateSeconds(s: Script): number {
  let t = (wordCount(s) / s.wpm) * 60;
  for (const x of s.sentences) for (const k of x.tokens) {
    if (k.type === "pause") t += k.secs;
    if (k.type === "breath") t += BREATH;
  }
  return Math.round(t);
}
