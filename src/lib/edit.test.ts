import { describe, expect, it } from "vitest";
import { buildEdit, cutPoints, parseSilences, timeline, totalSeconds, type TakeInfo } from "./edit";

// A take: speech 0.5-3.0 (s1), 3.6-6.2 (s2, fluffed), 7.0-9.6 (s2 again), 10.2-12.0 (s3), then quiet.
const silences: [number, number][] = [[0, 0.5], [3.0, 3.6], [6.2, 7.0], [9.6, 10.2], [12.0, 13.0]];
const take1: TakeInfo = {
  file: "take-01.webm", take: 1, seconds: 13, lag: 2.4, video: true, silences,
  sentences: [
    { sentence: 1, start: 0, end: 5.9, text: "One." },        // reached s2 at 3.6 + lag
    { sentence: 2, start: 5.9, end: 9.0, text: "Two." },      // back to s2 (re-read) at 7.0 + lag
    { sentence: 2, start: 9.0, end: 12.5, text: "Two." },     // moved to s3 at 10.2 + lag
    { sentence: 3, start: 12.5, text: "Three." },             // take stopped at 13
  ],
};

describe("parseSilences", () => {
  it("reads silencedetect output, including a silence running to the end", () => {
    const log = "[silencedetect @ 0x1] silence_start: -0.002\n[silencedetect @ 0x1] silence_end: 0.5 | silence_duration: 0.5\n" +
      "[silencedetect @ 0x1] silence_start: 3.01\r\n[silencedetect @ 0x1] silence_end: 3.6 | silence_duration: 0.59\n[silencedetect @ 0x1] silence_start: 12";
    expect(parseSilences(log, 13)).toEqual([[0, 0.5], [3.01, 3.6], [12, 13]]);
  });
});

describe("cutPoints", () => {
  it("snaps lagged sentence times to the silences around the voice", () => {
    expect(cutPoints(take1, take1.sentences[0])).toEqual({ start: 0.4, end: 3.25 });
    expect(cutPoints(take1, take1.sentences[2])).toEqual({ start: 6.9, end: 9.85 });
    expect(cutPoints(take1, take1.sentences[3])).toEqual({ start: 10.1, end: 12.25 });
  });
  it("falls back to the shifted times when there is no silence nearby", () => {
    const t = { ...take1, silences: [] };
    expect(cutPoints(t, t.sentences[2])).toEqual({ start: 6.6, end: 10.1 });
  });
});

describe("buildEdit", () => {
  it("uses the last read of each sentence and flags missing ones", () => {
    const e = buildEdit([take1], 4);
    expect(e.map(x => x.reads.length)).toEqual([1, 2, 1, 0]);
    expect(e[1].chosen?.start).toBe(6.9); // the re-read, not the fluff
    expect(e[3].chosen).toBeNull();
    const segs = timeline(e);
    expect(segs.map(s => s.sentence)).toEqual([1, 2, 3]);
    expect(totalSeconds(segs)).toBeCloseTo(2.85 + 2.95 + 2.15, 5);
  });
  it("a later take (a redo) replaces earlier reads, and picks override", () => {
    const redo: TakeInfo = { file: "take-02.webm", take: 2, seconds: 4, lag: 0, video: true, silences: [[0, 0.4], [3.1, 4]],
      sentences: [{ sentence: 2, start: 0, text: "Two." }] };
    expect(buildEdit([redo, take1], 3)[1].chosen?.take).toBe(2);
    expect(buildEdit([take1, redo], 3, { 2: 1 })[1].chosen?.take).toBe(1);
  });
});
