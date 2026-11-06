import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseScript, replaceSentence, tokenize } from "./script";

const sample = readFileSync(new URL("../sample/1.3-whiteboard-script.md", import.meta.url), "utf8");

describe("parseScript", () => {
  const s = parseScript(sample);

  it("reads the title", () => expect(s.title).toBe("1.3 What is an API?"));

  it("splits into sentences", () => {
    expect(s.sentences).toHaveLength(10);
    expect(s.sentences[0].spoken).toBe("Welcome back.");
    expect(s.sentences[1].spoken).toBe("In this lesson we look at how an API lets two programs talk.");
  });

  it("hides ON SCREEN notes and attaches the step to the next sentence", () => {
    expect(s.sentences.some(x => /ON SCREEN/.test(x.source))).toBe(false);
    expect(s.sentences[0].step).toBe(1);
    expect(s.sentences[3].step).toBe(2);
    expect(s.sentences.filter(x => x.step).map(x => x.step)).toEqual([1, 2, 3, 4, 5]);
  });

  it("attaches pauses to the sentence before them", () => {
    expect(s.sentences[2].pause).toBe(1);
    expect(s.sentences[4].pause).toBe(2);
  });

  it("reads sentence colour tags", () => {
    expect(s.sentences[0].kind).toBe("intro");
    expect(s.sentences[3].kind).toBe("ex");
  });

  it("carries a colour tag to the following sentences of the same line", () => {
    expect(s.sentences[1].kind).toBe("intro");
    expect(parseScript("Plain one. {key} Key one. Key two.").sentences.map(x => x.kind)).toEqual(["plain", "key", "key"]);
  });

  it("keeps free-text ON SCREEN notes as cues", () => {
    const p = parseScript("[ON SCREEN: show the logo]\nHello there.");
    expect(p.sentences[0].notes).toEqual(["show the logo"]);
    expect(p.sentences[0].step).toBeUndefined();
  });

  it("handles Windows line endings and a bare [pause]", () => {
    const p = parseScript("One sentence. [pause]\r\nTwo sentence.");
    expect(p.sentences[0].pause).toBe(1);
    expect(p.sentences).toHaveLength(2);
  });
});

describe("tokenize", () => {
  it("marks stress and breath", () => {
    expect(tokenize("a **waiter**, / ok")).toEqual([
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
    expect(out.length).toBe(sample.length - "You never walk into the kitchen yourself.".length + "You never go into the kitchen.".length);
  });
  it("matches across a line break", () => {
    expect(replaceSentence("Hello\nworld. Next.", "Hello world.", "Hi.")).toBe("Hi. Next.");
  });
});
