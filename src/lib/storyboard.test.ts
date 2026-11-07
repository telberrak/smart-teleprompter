import { describe, expect, it } from "vitest";
import { parseScript } from "./script";
import { buildTimeline, scenes, slideSteps, stepAt } from "./storyboard";
import type { Segment } from "./edit";

const script = parseScript(`# Demo
Hello there. Welcome in.
[ON SCREEN: step 1]
This is a box. It talks to another box.
[ON SCREEN: step 2]
Here is an arrow.`);
const seg = (sentence: number, start: number, end: number): Segment => ({ sentence, take: 1, file: "t.webm", video: true, start, end, text: "" });

describe("storyboard", () => {
  it("knows the step of every sentence", () => {
    expect([1, 2, 3, 4, 5].map(n => stepAt(script, n))).toEqual([0, 0, 1, 1, 2]);
  });
  it("camera full screen before the first note, then one scene per step", () => {
    const segs = [seg(1, 0, 2), seg(2, 3, 4), seg(3, 5, 7.5), seg(4, 8, 9), seg(5, 10, 12)];
    expect(scenes(segs, script)).toEqual([
      { kind: "camera", step: 0, start: 0, end: 3 },
      { kind: "slide", step: 1, start: 3, end: 6.5 },
      { kind: "slide", step: 2, start: 6.5, end: 8.5 },
    ]);
  });
  it("audio-only takes show the first slide during the cold open", () => {
    const sc = scenes([seg(1, 0, 2), seg(3, 0, 1)], script, false);
    expect(sc).toEqual([{ kind: "slide", step: 1, start: 0, end: 3 }]);
    expect(slideSteps(sc)).toEqual([1]);
  });
  it("builds a timeline with images, captions and sentence times", () => {
    const tl = buildTimeline([seg(1, 0, 2), seg(5, 1, 3)], script, { hasCamera: true, video: "cut.mp4", image: s => `slides/step-${s}.png` });
    expect(tl.seconds).toBe(4);
    expect(tl.scenes.map(s => s.image)).toEqual([undefined, "slides/step-2.png"]);
    expect(tl.sentences.map(s => [s.sentence, s.start, s.end, s.text])).toEqual([[1, 0, 2, "Hello there."], [5, 2, 4, "Here is an arrow."]]);
    expect(tl.captions.map(c => c.text)).toEqual(["Hello there.", "Here is an arrow."]);
  });
});
