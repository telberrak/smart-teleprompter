/**
 * Parser for whiteboard scripts (1.x-whiteboard-script.md).
 *
 * Markup understood:
 *   # Title                 first level-1 heading = video title
 *   [ON SCREEN: step 3]     the next sentence shows diagram step 3; the note is hidden from the prompter
 *   [ON SCREEN: any text]   kept as a small cue on the next sentence
 *   [pause 2s] / [pause]    hold after the previous sentence (default 1 s)
 *   /                       breath mark
 *   **word**                stressed word
 *   {intro|key|def|ex|tr}   optional sentence colour at the start of a sentence
 */

export type Kind = "intro" | "key" | "def" | "ex" | "tr" | "plain";
export const KINDS: Kind[] = ["intro", "key", "def", "ex", "tr"];

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
  step?: number;
  notes: string[];
  pause?: number;
}

export interface Script {
  title: string;
  sentences: Sentence[];
}

const NOTE_RE = /\[\s*ON\s+SCREEN\s*:?\s*([^\]]*)\]/gi;
const PAUSE_RE = /\[\s*pause(?:\s+(\d+(?:\.\d+)?)\s*s?)?\s*\]/gi;
const KIND_RE = /^\{(intro|key|def|ex|tr)\}\s*/i;

/** Split a paragraph into sentences, keeping markers attached to their place. */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  // split after . ! ? (optionally followed by quotes/brackets) when followed by space + new sentence start
  const parts = text.split(/(?<=[.!?]["')\]]?)\s+(?=[\[{*"'A-Z0-9À-Ý])/u);
  for (const p of parts) if (p.trim()) out.push(p.trim());
  return out;
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  for (const raw of src.split(/\s+/).filter(Boolean)) {
    if (raw === "/" || raw === "//") { tokens.push({ type: "breath" }); continue; }
    const m = raw.match(/^\*\*(.+?)\*\*(.*)$/);
    if (m) tokens.push({ type: "word", text: m[1] + m[2], stress: true });
    else tokens.push({ type: "word", text: raw.replace(/\*\*/g, ""), stress: false });
  }
  return tokens;
}

export function parseScript(md: string): Script {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let title = "";
  const sentences: Sentence[] = [];
  let pendingStep: number | undefined;
  let pendingNotes: string[] = [];

  // Work through events in order: notes, pauses and text.
  const body: string[] = [];
  for (const line of lines) {
    const h = line.match(/^#\s+(.+)/);
    if (h && !title) { title = h[1].trim(); continue; }
    if (/^#{1,6}\s/.test(line)) continue; // other headings are section labels
    body.push(line);
  }

  // Paragraphs = blocks separated by blank lines; single newlines join.
  const paragraphs = body.join("\n").split(/\n\s*\n/);
  for (const para of paragraphs) {
    const flat = para.replace(/\n/g, " ").trim();
    if (!flat) continue;
    // Walk through the paragraph, splitting on markers.
    const pieces = flat.split(/(\[[^\]]*\])/g);
    let text = "";
    const flushText = () => {
      // A {kind} tag colours every following sentence of the same chunk until the next tag.
      let inherited: Kind = "plain";
      for (const s of splitSentences(text)) inherited = addSentence(s, inherited);
      text = "";
    };
    for (const piece of pieces) {
      if (!piece) continue;
      NOTE_RE.lastIndex = 0; PAUSE_RE.lastIndex = 0;
      const note = NOTE_RE.exec(piece);
      if (note && note[0] === piece) {
        flushText();
        const body = note[1].trim();
        const step = body.match(/^step\s*(\d+)/i);
        if (step) pendingStep = Number(step[1]);
        else if (body) pendingNotes.push(body);
        continue;
      }
      const pause = PAUSE_RE.exec(piece);
      if (pause && pause[0] === piece) {
        flushText();
        const last = sentences[sentences.length - 1];
        if (last) last.pause = (last.pause ?? 0) + (pause[1] ? Number(pause[1]) : 1);
        continue;
      }
      text += piece;
    }
    flushText();
  }

  function addSentence(raw: string, inherited: Kind): Kind {
    let src = raw.trim();
    if (!src || src === "/") return inherited;
    let kind: Kind = inherited;
    const k = src.match(KIND_RE);
    if (k) { kind = k[1].toLowerCase() as Kind; src = src.slice(k[0].length); }
    const tokens = tokenize(src);
    if (!tokens.some(t => t.type === "word")) return kind;
    const spoken = tokens.filter(t => t.type === "word").map(t => (t as { text: string }).text).join(" ");
    sentences.push({
      index: sentences.length, kind, source: src, spoken, tokens,
      step: pendingStep, notes: pendingNotes,
    });
    pendingStep = undefined; pendingNotes = [];
    return kind;
  }

  return { title: title || "Untitled script", sentences };
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
