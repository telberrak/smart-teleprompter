import { describe, expect, it } from "vitest";
import { parseScript } from "./script";
import type { Segment } from "./edit";
import { captionYAt, SHORT_LAYOUT, shortAss, shortCues, shortPieces, shortSeconds, stressedWords, suggestShort } from "./short";

const script = parseScript(`# What is an API?
=== PART 1. COLD OPEN ===
Ever wondered how apps talk? As I said earlier, this is lesson three.
[ON SCREEN: step 1]
An **API** is a menu of requests. Think of a waiter. The waiter takes your order.
[ON SCREEN: step 2]
Subscribe for the next lesson.`);
const len = [4, 6, 8, 5, 5, 4];
const segs: Segment[] = len.map((d, i) => ({ sentence: i + 1, take: 1, file: "t.webm", video: true, start: 0, end: d, text: "" }));

describe("short", () => {
  it("keeps the hook and picks the strongest passage within the limit", () => {
    expect(suggestShort(segs, script)).toEqual([1, 2, 3, 4, 5, 6].filter(n => n !== 2 && n !== 6));
    expect(suggestShort(segs, script, 16)).toEqual([1, 3]);
  });
  it("places pieces on the cut's clock with their slide", () => {
    const p = shortPieces(segs, script, [1, 3, 4]);
    expect(p.map(x => [x.sentence, x.from, x.to, x.step])).toEqual([[1, 0, 4], [3, 10, 18], [4, 18, 23]].map(([s, a, b]) => [s, a, b, s === 1 ? 0 : 1]));
    expect(shortSeconds(p)).toBe(17);
    expect(shortPieces(segs, script, [1], false)[0].step).toBe(1);
  });
  it("makes short captions with stressed words in the accent colour, placed per layout", () => {
    const p = shortPieces(segs, script, [1, 3]);
    const c = shortCues(p, n => script.sentences[n - 1].spoken);
    expect(c.every(x => x.text.length <= 22)).toBe(true);
    expect(c.at(-1)!.end).toBeLessThanOrEqual(12);
    const y = captionYAt(p, true);
    expect([y(1), y(6)]).toEqual([SHORT_LAYOUT.captionY.camera, SHORT_LAYOUT.captionY.both]);
    const ass = shortAss(c, { accent: "#f4b860", y, stressed: stressedWords(script, [3]) });
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toContain("{\\c&H0060B8F4}API");
    expect(ass).toMatch(/Dialogue: 0,0:00:00\.\d\d,.*,Short,,0,0,470,,/);
  });
});
