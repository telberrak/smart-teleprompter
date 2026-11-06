import type { Script } from "../lib/script";
import type { Slides } from "../lib/excalidraw";
import { Diagram } from "./Diagram";
import { Slide } from "./Slide";

export interface SlideView { slides: Slides | null; frameForStep: Map<number, number> }

/**
 * What the viewer sees at diagram step `step`: the matching Excalidraw frame when slides
 * are loaded, the drawn sample for the bundled script, or else the ON SCREEN note text.
 */
export function ScreenCard({ script, step, ghost, view }: { script: Script; step: number; ghost?: boolean; view: SlideView }) {
  const fi = view.frameForStep.get(step);
  if (view.slides && fi !== undefined && fi >= 0) return <Slide frame={view.slides.frames[fi]} />;
  if (!view.slides && script.title === "1.3 What is an API?") return <Diagram upTo={step} ghost={ghost} />;
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
