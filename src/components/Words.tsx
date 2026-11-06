import type { CSSProperties } from "react";
import type { Sentence } from "../lib/script";

/**
 * Render a sentence's tokens: stress in bold, breath marks as a soft slash,
 * pause marks as a small countdown pill. `pauseFill(w)` styles the pill that follows word w.
 */
export function Words({ s, wordClass, offset = 0, said = -1, now = -1, pauseFill }: {
  s: Sentence; wordClass?: string; offset?: number; said?: number; now?: number;
  pauseFill?: (afterWord: number) => CSSProperties | undefined;
}) {
  let w = 0;
  return (
    <>
      {s.tokens.map((t, i) => {
        if (t.type === "breath") return <span key={i}><span className="br" aria-label="breath">/</span> </span>;
        if (t.type === "pause") {
          const style = pauseFill?.(offset + w - 1);
          return <span key={i}><span className={wordClass ? "cue" : "pill pause inline"}>{wordClass && <span className="fill" style={style} />}<span>⏸ {t.long ? "long " : ""}{t.secs}s</span></span> </span>;
        }
        const id = offset + w++;
        const cls = [wordClass, t.stress && "st", id < said && "said", id === now && "now"].filter(Boolean).join(" ");
        return <span key={i}><span className={cls}>{t.text}</span> </span>;
      })}
    </>
  );
}
