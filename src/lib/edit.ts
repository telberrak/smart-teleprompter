// The edit: which recorded piece of which take becomes each sentence of the final video.
//
// Takes store, for every sentence, when the prompter reached it (and when it moved on).
// With voice following those times trail the voice by a known lag, so we shift them back and
// then snap each cut to the nearest silence in the audio. The last read of a sentence wins,
// which matches how you work: fluff, say it again, carry on.

export interface Mark { sentence: number; start: number; end?: number; text: string }

export interface TakeInfo {
  file: string;
  take: number;
  seconds: number;
  /** How late the sentence times are, in seconds (0 for simulated scrolling). */
  lag: number;
  video: boolean;
  sentences: Mark[];
  /** Silent stretches [from, to] in seconds, from FFmpeg silencedetect. */
  silences: [number, number][];
}

export interface Segment {
  sentence: number; take: number; file: string; video: boolean; start: number; end: number; text: string;
  /** Which read this is: "<take>.<n>", the n-th read of the sentence in that take (from 1). */
  id?: string;
}

/**
 * Your choice for one sentence. An unlocked choice holds until you record the sentence again
 * (the newer read then wins, as when you redo it); a locked one holds whatever you record later.
 */
export interface Pick { read: string; locked?: boolean; /** Highest take number when you chose. */ at: number }

/** What you decided in Review, saved next to the takes. Old saves hold a bare take number. */
export interface ReviewState { picks: Record<number, Pick | number>; hidden: string[] }
export const emptyReview = (): ReviewState => ({ picks: {}, hidden: [] });

const PAD_START = 0.1;
const PAD_END = 0.25;
const SEARCH = 1.5;

/** The silence whose end is closest to `t` (within the search window), if any. */
function silenceEndingNear(silences: [number, number][], t: number): [number, number] | null {
  let best: [number, number] | null = null;
  for (const s of silences) {
    if (Math.abs(s[1] - t) > SEARCH) continue;
    if (!best || Math.abs(s[1] - t) < Math.abs(best[1] - t)) best = s;
  }
  return best;
}

/** Where sentence `m` really starts and ends inside its take. */
export function cutPoints(take: TakeInfo, m: Mark): { start: number; end: number } {
  const lag = take.lag;
  const approxStart = Math.max(0, m.start - (m.start > 0 ? lag : 0));
  const approxEnd = m.end === undefined ? take.seconds : Math.max(approxStart, m.end - lag);

  // Start: just before the voice comes back after the silence nearest to approxStart.
  let start = approxStart;
  const s = silenceEndingNear(take.silences, approxStart);
  if (s) start = Math.max(0, s[1] - PAD_START);

  // End: just after the voice stops, i.e. the start of the silence before the next sentence.
  let end = approxEnd;
  if (m.end === undefined) {
    const tail = take.silences.find(x => x[1] >= take.seconds - 0.3 && x[0] > start);
    if (tail) end = Math.min(take.seconds, tail[0] + PAD_END);
  } else {
    const e = silenceEndingNear(take.silences, approxEnd);
    if (e && e[0] > start) end = Math.min(take.seconds, e[0] + PAD_END);
  }
  if (end - start < 0.3) return { start: approxStart, end: Math.max(approxEnd, approxStart + 0.3) };
  return { start: +start.toFixed(3), end: +end.toFixed(3) };
}

export interface SentenceEdit {
  sentence: number;
  /** Every recorded read of this sentence, oldest first. */
  reads: Segment[];
  /** The read used in the final video. */
  chosen: Segment | null;
}

/**
 * For sentences 1..count: every read, and the one to use: the latest, unless you chose
 * another (see Pick). Hidden reads are left out (they stay in the take file).
 */
export function buildEdit(takes: TakeInfo[], count: number, picks: ReviewState["picks"] = {}, hidden: string[] = []): SentenceEdit[] {
  const reads = new Map<number, Segment[]>();
  const gone = new Set(hidden);
  for (const t of [...takes].sort((a, b) => a.take - b.take)) {
    const seen = new Map<number, number>();
    for (const m of t.sentences) {
      if (m.sentence < 1 || m.sentence > count) continue;
      const { start, end } = cutPoints(t, m);
      if (end - start < 0.4) continue; // passed over too fast to be a real read
      const k = (seen.get(m.sentence) ?? 0) + 1;
      seen.set(m.sentence, k);
      const id = `${t.take}.${k}`;
      if (gone.has(`${m.sentence}:${id}`)) continue;
      const list = reads.get(m.sentence) ?? [];
      list.push({ sentence: m.sentence, take: t.take, file: t.file, video: t.video, start, end, text: m.text, id });
      reads.set(m.sentence, list);
    }
  }
  const out: SentenceEdit[] = [];
  for (let n = 1; n <= count; n++) {
    const r = reads.get(n) ?? [];
    const pick = picks[n];
    let chosen: Segment | undefined;
    if (typeof pick === "number") chosen = [...r].reverse().find(x => x.take === pick);
    else if (pick) {
      const x = r.find(y => y.id === pick.read);
      if (x && (pick.locked || !r.some(y => y.take > pick.at))) chosen = x;
    }
    out.push({ sentence: n, reads: r, chosen: chosen ?? r.at(-1) ?? null });
  }
  return out;
}

/** The key a hidden read is saved under. */
export const hiddenKey = (s: Segment) => `${s.sentence}:${s.id}`;

/** The segments of the final video, in script order. */
export const timeline = (edit: SentenceEdit[]): Segment[] => edit.flatMap(e => (e.chosen ? [e.chosen] : []));

export const totalSeconds = (segs: Segment[]) => segs.reduce((a, s) => a + (s.end - s.start), 0);

/** Parse FFmpeg `silencedetect` output into [from, to] pairs. */
export function parseSilences(log: string, duration: number): [number, number][] {
  const out: [number, number][] = [];
  let open: number | null = null;
  for (const line of log.split(/\r?\n/)) {
    const a = /silence_start: (-?[\d.]+)/.exec(line);
    if (a) { open = Math.max(0, +a[1]); continue; }
    const b = /silence_end: ([\d.]+)/.exec(line);
    if (b && open !== null) { out.push([open, +b[1]]); open = null; }
  }
  if (open !== null) out.push([open, duration]);
  return out;
}
