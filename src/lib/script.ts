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
 */

export type Kind = "intro" | "key" | "def" | "ex" | "tr" | "a" | "b" | "plain";

export type Token =
  | { type: "word"; text: string; stress: boolean }
  | { type: "breath" };

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
const KIND_RE = /^\{(intro|key|def|ex|tr)\}\s*/i;
export const LONG_PAUSE = 2.5;
export const BREATH = 0.3;

/** Split text into sentences after . ! ? (plus closing quotes, brackets or **, and a trailing / breath), before a new sentence start. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?]["'”)\]*]{0,4}(?:\s+\/)?)\s+(?=[\[{*"'“A-Z0-9À-Ý])/u)
    .map(s => s.trim())
    .filter(Boolean);
}

/** Tokenize one sentence. `bold` carries a **stress** span that started in an earlier sentence. */
export function tokenize(src: string, bold = false): { tokens: Token[]; bold: boolean } {
  const tokens: Token[] = [];
  for (const raw of src.split(/\s+/).filter(Boolean)) {
    if (raw === "/" || raw === "//") { tokens.push({ type: "breath" }); continue; }
    const marks = (raw.match(/\*\*/g) || []).length;
    const opens = raw.startsWith("**") || (raw.indexOf("**") > 0 && !bold && marks % 2 === 0);
    const stress = bold || opens || marks > 0;
    const text = raw.replace(/\*\*/g, "");
    if (marks % 2 === 1) bold = !bold;
    if (text) tokens.push({ type: "word", text, stress });
  }
  return { tokens, bold };
}

export function parseScript(md: string): Script {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let title = "";
  let wpm = 150;
  let tagged = false;
  const sections: string[] = [];
  const sentences: Sentence[] = [];
  let section: string | undefined;
  let pendingStep: number | undefined;
  let pendingScreen: string | undefined;
  let pendingNotes: string[] = [];
  let autoStep = 0;
  let bold = false;

  // Pass 1: header lines and sections. Remaining text goes to paragraphs.
  const blocks: { section?: string; text: string }[] = [];
  let buf: string[] = [];
  const flush = () => { if (buf.join("").trim()) blocks.push({ section, text: buf.join(" ") }); buf = []; };
  let seenTitle = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t) { flush(); continue; }
    if (!seenTitle) {
      const h = t.match(/^#\s+(.+)$/) || t.match(/^\*\*(.+)\*\*$/);
      if (h) { title = h[1].trim(); seenTitle = true; continue; }
    }
    seenTitle = true;
    if (/^\(.*\)$/.test(t)) {
      const w = t.match(/(\d+)\s+(?:spoken\s+)?words\s+per\s+minute/i);
      if (w) wpm = Number(w[1]);
      continue;
    }
    if (/^bold\s*=/i.test(t)) continue;
    const sec = t.match(/^={2,}\s*(.+?)\s*={2,}$/) || t.match(/^#{2,6}\s+(.+)$/);
    if (sec) { flush(); section = sec[1].replace(/^PART\s+\d+\.\s*/i, ""); sections.push(section); continue; }
    if (/^#\s/.test(t)) continue;
    buf.push(t);
  }
  flush();
  if (/\{(intro|key|def|ex|tr)\}/i.test(md)) tagged = true;

  for (const block of blocks) {
    const pieces = block.text.split(/(\[[^\]]*\])/g);
    let text = "";
    const flushText = () => {
      let inherited: Kind = "plain";
      for (const s of splitSentences(text)) inherited = addSentence(s, inherited, block.section);
      text = "";
    };
    for (const piece of pieces) {
      if (!piece) continue;
      const note = piece.match(NOTE_RE);
      if (note) {
        flushText();
        const body = note[1].trim();
        const explicit = body.match(/^step\s*(\d+)\s*$/i);
        if (explicit) { pendingStep = Number(explicit[1]); autoStep = pendingStep; }
        else if (body) { pendingStep = ++autoStep; pendingScreen = body; }
        continue;
      }
      const pause = piece.match(PAUSE_RE);
      if (pause) {
        flushText();
        const last = sentences[sentences.length - 1];
        const secs = pause[2] ? Number(pause[2]) : pause[1] ? LONG_PAUSE : 1;
        if (last) last.pause = (last.pause ?? 0) + secs;
        continue;
      }
      text += piece;
    }
    flushText();
  }

  function addSentence(raw: string, inherited: Kind, sec?: string): Kind {
    let src = raw.trim();
    if (!src || src === "/") return inherited;
    let kind: Kind = inherited;
    const k = src.match(KIND_RE);
    if (k) { kind = k[1].toLowerCase() as Kind; src = src.slice(k[0].length); }
    const r = tokenize(src, bold);
    const words = r.tokens.filter((t): t is Extract<Token, { type: "word" }> => t.type === "word");
    if (!words.length) return kind;
    bold = r.bold;
    sentences.push({
      index: sentences.length,
      kind: tagged ? kind : sentences.length % 2 === 0 ? "a" : "b",
      source: src,
      spoken: words.map(w => w.text).join(" "),
      tokens: r.tokens,
      section: sec,
      step: pendingStep,
      screen: pendingScreen,
      notes: pendingNotes,
    });
    pendingStep = undefined; pendingScreen = undefined; pendingNotes = [];
    return kind;
  }

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
  for (const x of s.sentences) {
    t += x.pause ?? 0;
    t += x.tokens.filter(k => k.type === "breath").length * BREATH;
  }
  return Math.round(t);
}
