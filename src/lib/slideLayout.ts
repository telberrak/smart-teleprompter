// Where a slide's drawing lands in the 1920x1080 video frame (shared by the renderer and the checks).
import type { Frame } from "./excalidraw";

export const W = 1920, H = 1080;
/** Space kept clear around the slide: a little air, and room for captions at the bottom. */
export const PAD = { left: 64, right: 64, top: 40, bottom: 130 };

/** Scale and offset that fit `frame` inside the padded video frame. */
export function fitFrame(frame: Frame, w = W, h = H) {
  const aw = w - PAD.left - PAD.right, ah = h - PAD.top - PAD.bottom;
  const s = Math.min(aw / frame.width, ah / frame.height);
  return { s, ox: PAD.left + (aw - frame.width * s) / 2, oy: PAD.top + (ah - frame.height * s) / 2 };
}

export interface Box { x: number; y: number; w: number; h: number }

/** Every drawn element of the slide as a box in video pixels. */
export function frameBoxes(frame: Frame): Box[] {
  const { s, ox, oy } = fitFrame(frame);
  return frame.elements.filter(e => e.width > 0 || e.height > 0).map(e => ({
    x: ox + (e.x - frame.x) * s, y: oy + (e.y - frame.y) * s, w: Math.abs(e.width) * s, h: Math.abs(e.height) * s,
  }));
}

export const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
