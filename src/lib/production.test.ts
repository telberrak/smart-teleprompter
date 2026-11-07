import { describe, expect, it } from "vitest";
import { parseScript } from "./script";
import { at, bestCorner, refit, buildProduction, chapterName, chapters, clipsOn, description, move, proChecks, snap, split, trim, update } from "./production";
import type { Segment } from "./edit";
import type { Frame } from "./excalidraw";

const script = parseScript(`# What is an API?
=== PART 1. COLD OPEN ===
Hello there. Welcome in.
=== PART 2. THE WAITER ===
[ON SCREEN: step 1]
This is a box. It talks to another box.
=== PART 3. JSON ===
[ON SCREEN: step 2]
Here is an arrow. And that is all.`);
// 7 sentences, 5 s each = 35 s
const segs: Segment[] = Array.from({ length: 7 }, (_, i) => ({ sentence: i + 1, take: 1, file: "t.webm", video: true, start: 0, end: 5, text: "" }));

describe("production", () => {
  const p = buildProduction(segs, script, { hasCamera: true, corner: "br" });
  it("names chapters from the PART headings", () => {
    expect(chapterName("PART 2. THE WAITER")).toBe("The waiter");
    expect(chapters(segs, script)).toEqual([{ start: 0, name: "Cold open" }, { start: 10, name: "The waiter" }, { start: 20, name: "Json" }]);
  });
  it("places titles, camera, slides, sound and captions", () => {
    expect(p.seconds).toBe(35);
    expect(clipsOn(p, "titles").map(t => [t.kind, t.start])).toEqual([["title", 0], ["lower", 4.5], ["chapter", 10], ["chapter", 20], ["outro", 30]]);
    expect(clipsOn(p, "camera").map(c => [c.layout, c.start, c.end])).toEqual([["full", 0, 10], ["bubble", 10, 35]]);
    expect(clipsOn(p, "slides").map(s => [s.step, s.start, s.end])).toEqual([[1, 10, 20], [2, 20, 35]]);
    expect(clipsOn(p, "sfx").map(s => s.start)).toEqual([19.7]);
    expect(at(p, 12)).toMatchObject({ layout: "bubble", corner: "br" });
    expect(at(p, 2).layout).toBe("full");
  });
  it("splits, moves inside the video, and a slide can override the bubble corner", () => {
    const cam = clipsOn(p, "camera")[1];
    const q = split(p, cam.id, 25);
    expect(clipsOn(q, "camera").map(c => [c.start, c.end])).toEqual([[0, 10], [10, 25], [25, 35]]);
    const t = clipsOn(p, "titles")[0];
    expect(clipsOn(move(p, t.id, 33), "titles").find(x => x.id === t.id)).toMatchObject({ start: 31, end: 35 });
    const s2 = clipsOn(p, "slides")[1];
    expect(at(update(p, s2.id, { corner: "tl" }), 22).corner).toBe("tl");
  });
  it("snaps to sentence boundaries", () => {
    expect(snap(9.8, [0, 5, 10, 15])).toBe(10);
    expect(snap(7.5, [0, 5, 10, 15])).toBe(7.5);
  });
  it("finds a corner the bubble does not cover, and offers it as a fix", () => {
    // A slide whose drawing fills the bottom-right corner.
    const frame: Frame = { id: "f", name: "x", x: 0, y: 0, width: 1600, height: 900, words: "",
      elements: [{ id: "a", type: "rectangle", x: 1100, y: 500, width: 500, height: 400 }, { id: "b", type: "rectangle", x: 0, y: 0, width: 700, height: 100 }] };
    expect(bestCorner(frame).corner).toBe("tr"); // first free corner in order br, tr, bl, tl
    const checks = proChecks(p, script, segs, () => frame);
    const b = checks.find(c => c.id === "bubble")!;
    expect(b.ok).toBe(false);
    const fixed = b.fix!.apply(p);
    expect(clipsOn(fixed, "slides").map(s => s.corner)).toEqual(["tr", "tr"]);
    expect(proChecks(fixed, script, segs, () => frame).find(c => c.id === "bubble")!.ok).toBe(true);
  });
  it("writes a YouTube description with chapters", () => {
    expect(description(p, segs, script)).toBe("What is an API?\n\n0:00 Cold open\n0:10 The waiter\n0:20 Json\n");
  });
  it("refit keeps titles, music and settings on a changed cut", () => {
    const q = update(p, clipsOn(p, "captions")[0].id, { style: "bold" });
    const shorter = buildProduction(segs.slice(0, 5), script, { hasCamera: true, corner: "br" });
    const r = refit(q, shorter);
    expect(r.seconds).toBe(25);
    expect(clipsOn(r, "titles").map(t => [t.kind, t.start, t.end])).toEqual([["title", 0, 4], ["lower", 4.5, 10], ["chapter", 10, 13], ["chapter", 20, 23], ["outro", 20, 25]]);
    expect(clipsOn(r, "captions")[0].style).toBe("bold");
    expect(r.cutKey).toBe(shorter.cutKey);
  });
});

describe("trimming clips", () => {
  const p = buildProduction(segs, script, { hasCamera: true, corner: "br" });
  it("moves the shared edge of two touching slides together", () => {
    const [a, b] = clipsOn(p, "slides");
    if (!b || Math.abs(a.end - b.start) > 0.05) return;
    const q = trim(p, b.id, "start", a.end - 1);
    const [a2, b2] = clipsOn(q, "slides");
    expect(b2.start).toBeCloseTo(a.end - 1);
    expect(a2.end).toBeCloseTo(b2.start);
  });
  it("keeps a minimum length and the camera covering the whole video", () => {
    const [a] = clipsOn(p, "slides");
    const q = trim(p, a.id, "end", a.start - 5);
    expect(clipsOn(q, "slides")[0].end - a.start).toBeCloseTo(0.5);
    const cam = clipsOn(p, "camera")[0];
    expect(trim(p, cam.id, "start", 3)).toBe(p);
  });
  it("leaves voice and captions alone", () => {
    const v = clipsOn(p, "voice")[0];
    expect(trim(p, v.id, "end", 1)).toBe(p);
  });
});
