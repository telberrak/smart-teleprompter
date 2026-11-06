import { useState } from "react";
import type { Script } from "../lib/script";
import { wordCount, estimateSeconds } from "../lib/script";
import { ScreenCard, type SlideView } from "./ScreenCard";
import { Words } from "./Words";
import { EditableLine } from "./EditableLine";

interface Props {
  script: Script;
  view: SlideView;
  onOpenSlides: () => void;
  fileName: string;
  saved: boolean;
  onOpen: () => void;
  onEdit: (index: number, source: string) => void;
  onRecord: () => void;
}

export function Prepare({ script, view, fileName, saved, onOpen, onOpenSlides, onEdit, onRecord }: Props) {
  const [editing, setEditing] = useState<number | null>(null);
  const [focusStep, setFocusStep] = useState<number | null>(null);
  const S = script.sentences;
  const words = wordCount(script);
  const pauses = S.reduce((a, s) => a + (s.pause ?? 0), 0);
  const secs = estimateSeconds(script);
  const steps = S.filter(s => s.step).map(s => ({ n: s.step!, at: s.index, text: s.screen }));
  const maxStep = Math.max(0, ...steps.map(s => s.n));

  const pickStep = (n: number) => {
    setFocusStep(n);
    const at = S.find(s => s.step === n)?.index;
    if (at !== undefined) document.getElementById("s-" + at)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  return (
    <section className="screen on" id="prepare">
      <aside className="panel">
        <div className="ph"><h2>Script file</h2></div>
        <div className="files">
          <span className="label">Loaded</span>
          <div><i>✓</i>{fileName}</div>
          <div>{view.slides ? <><i>✓</i>{view.slides.fileName} · {view.slides.frames.length} slides</> : <span style={{ color: "var(--ink-3)" }}>No slides loaded</span>}</div>
          <div style={{ color: saved ? "var(--good)" : "var(--ink-3)" }}>{saved ? "Edits save to this file" : "Sample / browser mode: edits stay in memory"}</div>
        </div>
        <div className="go" style={{ marginTop: 0, borderTop: 0 }}>
          <button className="btn" onClick={onOpen}>Open a script…</button>
          <button className="btn ghost" onClick={onOpenSlides}>Open slides…</button>
        </div>
      </aside>

      <div className="panel">
        <div className="ph"><h2>{script.title}</h2><span className="meta">click any sentence to edit</span></div>
        <div className="checkbar">
          <span><b>{S.length}</b> sentences</span>
          <span><b>{words}</b> words</span>
          <span><b>{steps.length}</b> diagram steps</span>
          <span><b>{Math.round(pauses)}s</b> of pauses</span>
          {script.sections.length > 0 && <span><b>{script.sections.length}</b> parts</span>}
          <span>about <b>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</b> at {script.wpm} wpm</span>
        </div>
        {!script.tagged ? <div className="legend">
          <span><i style={{ background: "#8fb2ff" }} />Navy</span>
          <span><i style={{ background: "#ffa266" }} />Orange</span>
          <span>Each sentence alternates colour, as in your reading scripts</span>
        </div> : <div className="legend">
          <span><i style={{ background: "var(--k-intro)" }} />Intro</span>
          <span><i style={{ background: "var(--k-key)" }} />Key point</span>
          <span><i style={{ background: "var(--k-def)" }} />Definition</span>
          <span><i style={{ background: "var(--k-ex)" }} />Example</span>
          <span><i style={{ background: "var(--k-tr)" }} />Transition</span>
        </div>}
        <div className="script">
          {S.map(s => {
            const n = s.tokens.filter(t => t.type === "word").length;
            return (
              <div key={s.index}>
                {s.section && s.section !== S[s.index - 1]?.section && <div className="sec-head">{s.section}</div>}
                <div className={"sent" + (focusStep && s.step === focusStep ? " hl" : "")} id={"s-" + s.index}>
                  <span className="no">{String(s.index + 1).padStart(2, "0")}</span>
                  <div className={"tx k-" + s.kind} onClick={() => setEditing(s.index)}>
                    {editing === s.index
                      ? <EditableLine value={s.source} onSave={v => { onEdit(s.index, v); setEditing(null); }} onCancel={() => setEditing(null)} />
                      : <Words s={s} />}
                  </div>
                  <div className="side">
                    {s.step && <span className="pill step" title={s.screen} onClick={() => pickStep(s.step!)}>ON SCREEN · {s.step}</span>}
                    {s.notes.map((x, i) => <span key={i} className="pill">{x}</span>)}
                  </div>
                </div>
                {n > 25 && <div className="warn">Sentence {s.index + 1} is long ({n} words). It may be hard to read aloud.</div>}
              </div>
            );
          })}
        </div>
      </div>

      <aside className="panel">
        <div className="ph"><h2>On screen</h2><span className="meta">{steps.length} steps</span></div>
        <div className="slide-wrap">
          <div className="slide"><ScreenCard script={script} view={view} step={focusStep ?? (script.tagged ? maxStep : 1)} ghost={focusStep !== null} /></div>
          <span className="label">ON SCREEN steps · click to find the sentence</span>
          <ul className="steps">
            {steps.map(st => (
              <li key={st.n}><button className={focusStep === st.n ? "on" : ""} onClick={() => pickStep(st.n)}>
                <span className="sn">{st.n}</span><span className="st-text">{view.slides && (view.frameForStep.get(st.n) ?? -1) >= 0 ? <b>{view.slides.frames[view.frameForStep.get(st.n)!].name}</b> : null}{view.slides ? " · " : ""}{st.text ?? `Step ${st.n}`}</span><span className="at">#{st.at + 1}</span>
              </button></li>
            ))}
          </ul>
        </div>
        <div className="go">
          <button className="btn primary" onClick={onRecord}>Start recording</button>
          <span className="hint">Voice is simulated until milestone 2</span>
        </div>
      </aside>
    </section>
  );
}
