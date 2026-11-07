// Where the round camera bubble sits over the slides: in the whiteboard video, the Remotion
// project and the Record screen's whiteboard mode. One setting, remembered between sessions.
export type Corner = "tl" | "tr" | "bl" | "br";
export const CORNERS: { id: Corner; label: string }[] = [
  { id: "tl", label: "Top left" }, { id: "tr", label: "Top right" },
  { id: "bl", label: "Bottom left" }, { id: "br", label: "Bottom right" },
];
export const DEFAULT_CORNER: Corner = "br";
const KEY = "tp.bubble";
export const isCorner = (c: unknown): c is Corner => c === "tl" || c === "tr" || c === "bl" || c === "br";
export function loadCorner(): Corner {
  try { const v = localStorage.getItem(KEY); return isCorner(v) ? v : DEFAULT_CORNER; } catch { return DEFAULT_CORNER; }
}
export function saveCorner(c: Corner) { try { localStorage.setItem(KEY, c); } catch { /* private window */ } }

/** Top-left position of a `size` bubble `margin` from the chosen corner of a w x h frame. */
export function bubbleXY(corner: Corner, w: number, h: number, size: number, margin: number) {
  return { x: corner[1] === "l" ? margin : w - size - margin, y: corner[0] === "t" ? margin : h - size - margin };
}
