import { describe, expect, it } from "vitest";
import type { ExElement, Frame } from "./excalidraw";
import { plan, timedWords, units } from "./drawOn";
import { drawTimes } from "./slideImage";

const el = (id: string, type: string, x: number, y: number, w: number, h: number, extra: Partial<ExElement> = {}): ExElement =>
  ({ id, type, x, y, width: w, height: h, ...extra });

// Title, two boxes with labels, an arrow from the first to the second.
const frame: Frame = {
  id: "f", name: "Frame", x: 0, y: 0, width: 1600, height: 900, words: "",
  elements: [
    el("t", "text", 600, 40, 400, 60, { text: "How data moves", fontSize: 48 }),
    el("a", "rectangle", 100, 300, 300, 160),
    el("at", "text", 150, 360, 200, 40, { text: "Trading app", fontSize: 28 }),
    el("b", "rectangle", 1100, 300, 300, 160),
    el("bt", "text", 1150, 360, 200, 40, { text: "Orders database", fontSize: 28 }),
    el("ar", "arrow", 400, 380, 700, 0, { points: [[0, 0], [700, 0]] }),
  ],
};

describe("draw-in plan", () => {
  it("groups each box with its label", () => {
    const u = units(frame);
    const box = u.find(x => x.elements.some(e => e.id === "a"))!;
    expect(box.elements.map(e => e.id).sort()).toEqual(["a", "at"]);
  });

  it("draws a part when its name is said, title first, arrow before its target", () => {
    const words = timedWords(
      [{ sentence: 1, start: 0, end: 4 }, { sentence: 2, start: 0, end: 4 }],
      n => (n === 1 ? "Here is the trading app you use every day." : "Each order is saved in the database."),
    );
    const p = plan(frame, "said", 0, 8, words);
    const when = (id: string) => p.find(x => x.unit.elements.some(e => e.id === id))!.start;
    expect(when("t")).toBeLessThan(0.5);
    expect(when("a")).toBeGreaterThan(when("t"));
    expect(when("b")).toBeGreaterThan(4);
    expect(when("ar")).toBeLessThanOrEqual(when("b"));
    for (const x of p) expect(x.start).toBeLessThanOrEqual(8 - 0.2);
  });

  it("quick mode draws everything early, one after another", () => {
    const p = plan(frame, "quick", 10, 30);
    expect(Math.max(...p.map(x => x.start + x.dur))).toBeLessThan(20);
  });
});

describe("export pictures", () => {
  it("samples while drawing and holds in between", () => {
    const times = drawTimes([{ unit: units(frame)[0], start: 2, dur: 0.5 }], 0, 5);
    expect(times[0]).toBe(0);
    expect(times[1]).toBeCloseTo(2);
    const during = times.filter(t => t >= 2 && t < 2.5).length;
    expect(during).toBeGreaterThanOrEqual(14);
    expect(times.length).toBeLessThan(20);
  });
});
