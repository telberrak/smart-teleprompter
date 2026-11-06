import { describe, it, expect } from "vitest";
import { parseSlides, matchNotesToFrames } from "./excalidraw";

const frame = (id: string, name: string, y: number) => ({ id, type: "frame", name, x: 0, y, width: 1920, height: 1080 });
const text = (id: string, frameId: string, t: string) => ({ id, type: "text", text: t, frameId, x: 10, y: 10, width: 100, height: 40 });
const file = JSON.stringify({
  type: "excalidraw",
  elements: [
    frame("b", "02 Market data", 1200), frame("a", "01 Fault and failure", 0), frame("c", "03 Recap", 2400),
    text("t1", "a", "Order gateway"), text("t2", "b", "push pull screens"), text("t3", "c", "three cards"),
    { id: "gone", type: "text", text: "deleted", frameId: "a", isDeleted: true, x: 0, y: 0, width: 1, height: 1 },
  ],
});

describe("parseSlides", () => {
  const s = parseSlides(file);
  it("orders frames by their number", () => expect(s.frames.map(f => f.name)).toEqual(["01 Fault and failure", "02 Market data", "03 Recap"]));
  it("keeps each frame's elements and skips deleted ones", () => {
    expect(s.frames[0].elements.map(e => e.id)).toEqual(["t1"]);
  });
  it("rejects files that are not Excalidraw", () => expect(() => parseSlides("{}")).toThrow());
});

describe("matchNotesToFrames", () => {
  const { frames } = parseSlides(file);
  it("maps one note per frame when the counts match", () => {
    expect(matchNotesToFrames(["x", "y", "z"], frames)).toEqual([0, 1, 2]);
  });
  it("lets several notes share a frame, in order, by shared words", () => {
    const notes = ["a chain of boxes, the order gateway turns red: fault", "the gateway failure spreads", "market data feed: push or pull to screens", "the three cards again"];
    expect(matchNotesToFrames(notes, frames)).toEqual([0, 0, 1, 2]);
  });
});
