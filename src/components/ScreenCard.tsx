import type { Script } from "../lib/script";
import { Diagram } from "./Diagram";

/**
 * What the viewer sees for the current diagram step.
 * The bundled sample has a drawn diagram; real scripts show the ON SCREEN note
 * until Excalidraw frames are wired in (milestone 6).
 */
export function ScreenCard({ script, step, ghost }: { script: Script; step: number; ghost?: boolean }) {
  if (script.title === "1.3 What is an API?") return <Diagram upTo={step} ghost={ghost} />;
  const steps = script.sentences.filter(s => s.step);
  const cur = steps.filter(s => (s.step ?? 0) <= step).at(-1);
  return (
    <div className="note-card">
      <span className="nc-step">{cur ? `ON SCREEN ${cur.step} / ${steps.length}` : "Before the first ON SCREEN note"}</span>
      <p>{cur?.screen ?? (cur ? `Step ${cur.step}` : "")}</p>
      {cur?.section && <span className="nc-sec">{cur.section}</span>}
    </div>
  );
}
