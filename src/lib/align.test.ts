import { describe, expect, it } from "vitest";
import { align, heardWords, norm, similar } from "./align";

const script = heardWords(
  "Picture a Monday morning at a bank. The market opened one minute ago. One of the servers has a disk " +
  "that just died. And by lunchtime, someone asks: how did one disk stop the whole bank? So, in one line: " +
  "every system is judged by three questions. Reliability. Faults will happen.");
const at = (w: string, from = 0) => script.indexOf(w, from);

describe("norm / heardWords", () => {
  it("normalises words and numbers", () => {
    expect(norm("Bank.")).toBe("bank");
    expect(norm("3")).toBe("three");
    expect(norm("don’t")).toBe("dont");
    expect(heardWords(" [BLANK_AUDIO] The market (laughs) opened—one minute")).toEqual(["the", "market", "opened", "one", "minute"]);
  });
  it("scores near-misses", () => {
    expect(similar("servers", "server")).toBeGreaterThan(0.8);
    expect(similar("bank", "disk")).toBeLessThan(0.6);
  });
});

describe("align", () => {
  it("finds the position from a clean transcript", () => {
    const r = align(script, -1, heardWords("Picture a Monday morning at a bank"));
    expect(r?.pos).toBe(at("bank"));
  });

  it("moves forward as more is heard (overlapping windows)", () => {
    let pos = at("bank");
    pos = align(script, pos, heardWords("at a bank. The market opened one minute"))!.pos;
    expect(pos).toBe(at("minute"));
    pos = align(script, pos, heardWords("one minute ago. One of the servers has a"))!.pos;
    expect(script[pos]).toBe("a");
    expect(pos).toBe(at("has") + 1);
  });

  it("tolerates misheard words", () => {
    const pos = at("ago");
    const r = align(script, pos, heardWords("one of the service has the desk that just"));
    expect(r?.pos).toBe(at("just"));
  });

  it("picks the right occurrence of a repeated word", () => {
    // "one" appears several times; context decides.
    const pos = at("lunchtime");
    const r = align(script, pos, heardWords("someone asks how did one"));
    expect(r?.pos).toBe(at("one", at("did")));
  });

  it("ignores silence, noise and ad-libs", () => {
    expect(align(script, 5, [])).toBeNull();
    expect(align(script, 5, heardWords("okay let me try that again"))).toBeNull();
  });

  it("does not jump back on a weak match but does for a clear re-read", () => {
    const pos = at("questions");
    expect(align(script, pos, heardWords("the bank"))).toBeNull();
    const r = align(script, pos, heardWords("how did one disk stop the whole bank"));
    expect(r?.pos).toBe(at("bank", at("whole")));
  });
});
