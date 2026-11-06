import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseScript, replaceSentence, tokenize, splitSentences, estimateSeconds } from "./script";

const sample = readFileSync(new URL("../sample/1.3-whiteboard-script.md", import.meta.url), "utf8");

// Same shape as the real course scripts (bold title, meta lines, === PART === sections, free-text ON SCREEN notes).
const real = `**Reliability: The Three Questions**
(About 12 minutes. Format: Detailed, timed at 228 spoken words per minute plus pauses.)
Bold = stress. / = brief pause. [pause] = 1 second. [long pause] = 2 to 3 seconds.

=== PART 1. COLD OPEN ===

[ON SCREEN: a trading floor at 9:31. A red banner: "Order gateway: degraded".]

Picture a Monday morning at a bank. / The market opened one minute ago. [pause] One of the servers / has a disk that just died. [long pause]

And by lunchtime, / someone asks: / **"How did one disk stop the whole bank?"** [long pause]

=== PART 2. THE FOUNDATIONS ===

[ON SCREEN: three cards side by side.]

So, / in one line: / **every system is judged by three questions: / does it survive, / and can people live with it.** [long pause]

**Reliability.** / Faults will happen. [pause]
`;

describe("real script format", () => {
  const s = parseScript(real);

  it("reads the bold title and the pace, and skips meta lines", () => {
    expect(s.title).toBe("Reliability: The Three Questions");
    expect(s.wpm).toBe(228);
    expect(s.sentences.some(x => /Bold =|About 12/.test(x.source))).toBe(false);
  });

  it("reads sections", () => {
    expect(s.sections).toEqual(["COLD OPEN", "THE FOUNDATIONS"]);
    expect(s.sentences[0].section).toBe("COLD OPEN");
    expect(s.sentences.at(-1)!.section).toBe("THE FOUNDATIONS");
  });

  it("numbers free-text ON SCREEN notes as steps and hides them", () => {
    expect(s.sentences[0].step).toBe(1);
    expect(s.sentences[0].screen).toMatch(/^a trading floor/);
    const two = s.sentences.find(x => x.step === 2)!;
    expect(two.spoken).toBe("So, in one line: every system is judged by three questions: does it survive, and can people live with it.");
    expect(s.sentences.some(x => /ON SCREEN/.test(x.source))).toBe(false);
  });

  it("reads [pause] and [long pause]", () => {
    expect(s.sentences[1].pause).toBe(1);
    expect(s.sentences[2].pause).toBe(2.5);
  });

  it("stresses every word of a multi-word bold span, across breath marks", () => {
    const q = s.sentences.find(x => x.spoken.startsWith("And by lunchtime"))!;
    const words = q.tokens.filter(t => t.type === "word") as { text: string; stress: boolean }[];
    expect(words.filter(w => w.stress).map(w => w.text).join(" ")).toBe('"How did one disk stop the whole bank?"');
    const line = s.sentences.find(x => x.step === 2)!;
    const st = (line.tokens.filter(t => t.type === "word") as { text: string; stress: boolean }[]);
    expect(st.find(w => w.text === "So,")!.stress).toBe(false);
    expect(st.find(w => w.text === "survive,")!.stress).toBe(true);
    expect(st.at(-1)!.stress).toBe(true);
  });

  it("splits after a bold sentence", () => {
    expect(splitSentences("**Reliability.** / Faults will happen.")).toEqual(["**Reliability.** /", "Faults will happen."]);
  });

  it("follows colour_sentences.py: sentences run across lines, pauses stay inside", () => {
    const p = parseScript("**T**\n\nOne of the servers /\nhas a disk. [pause] Next one [long pause] goes on. / Last.");
    expect(p.sentences.map(x => x.source)).toEqual([
      "One of the servers / has a disk. [pause]",
      "Next one [long pause] goes on. /",
      "Last.",
    ]);
    expect(p.sentences[1].pause).toBe(2.5);
    expect(p.sentences[1].tokens.map(t => t.type)).toEqual(["word", "word", "pause", "word", "word", "breath"]);
  });

  it("alternates colours when there are no tags", () => {
    expect(s.tagged).toBe(false);
    expect(s.sentences.slice(0, 4).map(x => x.kind)).toEqual(["a", "b", "a", "b"]);
  });

  it("estimates reading time from the script pace", () => {
    expect(estimateSeconds(s)).toBeGreaterThan(10);
  });
});

describe("tagged sample script", () => {
  const s = parseScript(sample);
  it("reads the title", () => expect(s.title).toBe("1.3 What is an API?"));
  it("splits into sentences", () => {
    expect(s.sentences).toHaveLength(10);
    expect(s.sentences[0].spoken).toBe("Welcome back.");
  });
  it("uses explicit step numbers", () => {
    expect(s.sentences.filter(x => x.step).map(x => x.step)).toEqual([1, 2, 3, 4, 5]);
  });
  it("reads [pause Ns]", () => {
    expect(s.sentences[2].pause).toBe(1);
    expect(s.sentences[4].pause).toBe(2);
  });
  it("reads and carries colour tags", () => {
    expect(s.tagged).toBe(true);
    expect(s.sentences[0].kind).toBe("intro");
    expect(s.sentences[1].kind).toBe("intro");
    expect(s.sentences[3].kind).toBe("ex");
  });
  it("keeps free-text ON SCREEN notes as numbered steps", () => {
    const p = parseScript("[ON SCREEN: show the logo]\nHello there.");
    expect(p.sentences[0].step).toBe(1);
    expect(p.sentences[0].screen).toBe("show the logo");
  });
  it("handles Windows line endings and a bare [pause]", () => {
    const p = parseScript("One sentence. [pause]\r\nTwo sentence.");
    expect(p.sentences[0].pause).toBe(1);
    expect(p.sentences).toHaveLength(2);
  });
});

describe("tokenize", () => {
  it("marks stress and breath", () => {
    expect(tokenize("a **waiter**, / ok").tokens).toEqual([
      { type: "word", text: "a", stress: false },
      { type: "word", text: "waiter,", stress: true },
      { type: "breath" },
      { type: "word", text: "ok", stress: false },
    ]);
  });
});

describe("replaceSentence", () => {
  it("edits one sentence and keeps the rest of the file", () => {
    const out = replaceSentence(sample, "You never walk into the kitchen yourself.", "You never go into the kitchen.");
    expect(out).toContain("{ex} You never go into the kitchen. [pause 2s]");
  });
  it("matches across a line break", () => {
    expect(replaceSentence("Hello\nworld. Next.", "Hello world.", "Hi.")).toBe("Hi. Next.");
  });
});
