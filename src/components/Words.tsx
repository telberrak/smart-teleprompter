import type { Sentence } from "../lib/script";

/** Render a sentence's tokens: stress in bold, breath marks as a soft slash. */
export function Words({ s, wordClass, offset = 0, said = -1, now = -1 }: {
  s: Sentence; wordClass?: string; offset?: number; said?: number; now?: number;
}) {
  let w = 0;
  return (
    <>
      {s.tokens.map((t, i) => {
        if (t.type === "breath") return <span key={i}><span className="br" aria-label="breath">/</span> </span>;
        const id = offset + w++;
        const cls = [wordClass, t.stress && "st", id < said && "said", id === now && "now"].filter(Boolean).join(" ");
        return <span key={i}><span className={cls}>{t.text}</span> </span>;
      })}
    </>
  );
}
