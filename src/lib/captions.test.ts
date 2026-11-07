import { describe, expect, it } from "vitest";
import { chunk, cues, toSrt } from "./captions";

describe("chunk", () => {
  it("keeps short sentences whole and strips stress marks", () => {
    expect(chunk("Look at this **drawing** for a second.")).toEqual(["Look at this drawing for a second."]);
  });
  it("splits long sentences at punctuation within 42 characters", () => {
    const parts = chunk("By the end of this video, you'll be able to look at a drawing like this and ask the right question about every arrow.");
    expect(parts.every(p => p.length <= 42)).toBe(true);
    expect(parts[0]).toBe("By the end of this video,");
    expect(parts.join(" ")).toBe("By the end of this video, you'll be able to look at a drawing like this and ask the right question about every arrow.");
  });
});

describe("cues / toSrt", () => {
  it("times cues from the cut, back to back, inside each segment", () => {
    const segs = [
      { sentence: 1, take: 1, file: "a", video: true, start: 0.4, end: 3.4, text: "" },
      { sentence: 2, take: 1, file: "a", video: true, start: 7, end: 9, text: "" },
    ];
    const text = (n: number) => (n === 1 ? "One app, one database." : "Two.");
    const c = cues(segs, text);
    expect(c).toHaveLength(2);
    expect(c[0].start).toBeCloseTo(0.1); expect(c[0].end).toBeCloseTo(2.8);
    expect(c[1].start).toBeCloseTo(3.1); expect(c[1].end).toBeCloseTo(4.8);
    expect(toSrt(c)).toBe("1\n00:00:00,100 --> 00:00:02,800\nOne app, one database.\n\n2\n00:00:03,100 --> 00:00:04,800\nTwo.\n");
  });
});
