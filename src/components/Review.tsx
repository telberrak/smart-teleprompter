import { useMemo, useState } from "react";
import type { Script } from "../lib/script";
import { ScreenCard, type SlideView } from "./ScreenCard";

interface Take { d: string; best?: boolean; bad?: boolean }

// Deterministic fake waveform. Real takes and waveforms arrive with recording (milestone 3).
function Wave({ seed, silent }: { seed: number; silent: [number, number][] }) {
  let x = seed * 9301 + 49297;
  return (
    <span className="wv">
      {Array.from({ length: 34 }, (_, i) => {
        x = (x * 9301 + 49297) % 233280;
        const s = silent.some(([a, b]) => i >= a && i <= b);
        return s ? <i key={i} className="s" /> : <i key={i} style={{ height: 4 + Math.round((x / 233280) * 18) }} />;
      })}
    </span>
  );
}

export function Review({ script, view, onRedo }: { script: Script; view: SlideView; onRedo: (i: number) => void }) {
  const S = script.sentences;
  const initial = useMemo(() => S.map((s, i): Take[] => {
    const d = (n: number) => `${(s.tokens.length * 0.38 + n).toFixed(1)}s`;
    return i % 4 === 1 ? [{ d: d(0.4), bad: true }, { d: d(0), best: true }] : [{ d: d(0), best: true }];
  }), [S]);
  const [takes, setTakes] = useState(initial);
  const T = takes.length === S.length ? takes : initial;

  return (
    <section className="screen on" id="review">
      <div className="panel">
        <div className="ph"><h2>Takes by sentence</h2><span className="meta">sample takes · real ones arrive with recording</span></div>
        <div className="tl-head"><span className="label">#</span><span className="label">Sentence</span><span className="label">Takes</span><span className="label">Fix</span></div>
        <div className="tl">
          {S.map((s, i) => (
            <div className="tr" key={i}>
              <span className="no">{String(i + 1).padStart(2, "0")}</span>
              <span className="txt">{s.spoken}</span>
              <div className="takes">
                {T[i].map((k, j) => (
                  <button key={j} className={"take" + (k.best ? " best" : "") + (k.bad ? " bad" : "")}
                    onClick={() => setTakes(T.map((row, r) => r !== i ? row : row.map((x, c) => ({ ...x, best: c === j }))))}>
                    <Wave seed={i * 7 + j * 3 + 1} silent={j === 0 && i % 3 === 1 ? [[0, 6], [27, 33]] : [[28, 33]]} />
                    <span className="tm"><span>T{j + 1}{k.best && <span className="star"> ★</span>}</span><span>{k.d}</span></span>
                  </button>
                ))}
              </div>
              <button className="rr" onClick={() => onRedo(i)}><i />Redo</button>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="ph"><h2>Final cut</h2><span className="meta">preview</span></div>
        <div className="preview">
          <div className="frame"><ScreenCard script={script} view={view} step={S[Math.min(4, S.length - 1)]?.step ?? S.slice(0, 5).reduce((a, s) => s.step ?? a, 0)} /><span className="bubble" aria-hidden="true" /><span className="cap">{S[Math.min(4, S.length - 1)]?.spoken}</span></div>
          <span className="label">Exports (milestones 4 to 6)</span>
          <div className="outs">
            <div className="out"><span className="ext">MP4</span><span className="f">final video, silences cut</span><span className="sz">M4</span></div>
            <div className="out"><span className="ext">SRT</span><span className="f">captions from the script</span><span className="sz">M5</span></div>
            <div className="out"><span className="ext">JSON</span><span className="f">Remotion timeline</span><span className="sz">M6</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}
