import { useCallback, useEffect, useMemo, useState } from "react";
import sample from "./sample/1.3-whiteboard-script.md?raw";
import { parseScript, replaceSentence } from "./lib/script";
import { inElectron, openScript, openSlides, saveScript } from "./lib/bridge";
import { parseSlides, matchNotesToFrames, type Slides } from "./lib/excalidraw";
import type { SlideView } from "./components/ScreenCard";
import { Prepare } from "./components/Prepare";
import { Record } from "./components/Record";
import { Review } from "./components/Review";

type Screen = "prepare" | "record" | "review";
const SCREENS: Screen[] = ["prepare", "record", "review"];

export function App() {
  const [md, setMd] = useState(sample);
  const [file, setFile] = useState<{ path: string | null; name: string }>({ path: null, name: "1.3-whiteboard-script.md (sample)" });
  const [screen, setScreen] = useState<Screen>(() => (SCREENS.find(s => "#" + s === location.hash) ?? "prepare"));
  const [startAt, setStartAt] = useState(0);
  const [note, setNote] = useState("");
  const [slides, setSlides] = useState<Slides | null>(null);
  const script = useMemo(() => parseScript(md), [md]);
  // Which frame each ON SCREEN step shows
  const view = useMemo<SlideView>(() => {
    const steps = script.sentences.filter(s => s.step);
    const map = new Map<number, number>();
    if (slides) {
      const idx = matchNotesToFrames(steps.map(s => s.screen ?? ""), slides.frames);
      steps.forEach((s, i) => map.set(s.step!, idx[i]));
    }
    return { slides, frameForStep: map };
  }, [script, slides]);

  const loadSlides = (f: { name: string; content: string } | null | undefined) => {
    if (!f) { setSlides(null); return; }
    try { setSlides(parseSlides(f.content, f.name)); setNote(`Slides loaded: ${f.name}`); }
    catch (e) { setSlides(null); setNote(`Could not read ${f.name}: ${(e as Error).message}`); }
  };
  const pickSlides = async () => loadSlides(await openSlides());

  useEffect(() => { history.replaceState(null, "", "#" + screen); }, [screen]);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(""), 2800); return () => clearTimeout(t); }, [note]);

  const open = async () => {
    const f = await openScript();
    if (!f) return;
    setMd(f.content); setFile({ path: f.path, name: f.name }); setStartAt(0); setScreen("prepare");
    loadSlides("slides" in f ? f.slides : null);
  };

  const edit = useCallback((index: number, source: string) => {
    const old = script.sentences[index];
    if (!old) return;
    try {
      const next = replaceSentence(md, old.source, source);
      setMd(next);
      saveScript(file.path, next).then(ok => ok && setNote("Saved " + file.name)).catch(e => setNote("Could not save: " + e.message));
    } catch (e) {
      setNote("Could not apply the edit: " + (e as Error).message);
    }
  }, [md, script, file]);

  return (
    <div className={"app" + (screen === "record" ? " fit" : "")}>
      <header className="bar">
        <div className="brand"><span className="lens" aria-hidden="true" />Smart Teleprompter</div>
        <div className="crumb"><b>{script.title}</b></div>
        {!file.path && <span className="sample">{inElectron ? "SAMPLE SCRIPT" : "BROWSER PREVIEW"}</span>}
        <nav className="tabs" role="tablist" aria-label="Screens">
          {SCREENS.map((s, i) => (
            <button key={s} className="tab" role="tab" aria-selected={screen === s} onClick={() => { if (s === "record") setStartAt(0); setScreen(s); }}>
              <span className="n">{i + 1}</span>{s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </nav>
        <span className="offline">Offline</span>
      </header>
      {screen === "prepare" && <Prepare script={script} view={view} fileName={file.name} saved={!!file.path} onOpen={open} onOpenSlides={pickSlides} onEdit={edit} onRecord={() => { setStartAt(0); setScreen("record"); }} />}
      {screen === "record" && <Record script={script} view={view} startAt={startAt} onEdit={edit} scriptPath={file.path} />}
      {screen === "review" && <Review script={script} view={view} scriptPath={file.path} onRedo={i => { setStartAt(i); setScreen("record"); }} />}
      <div className={"gtoast" + (note ? " show" : "")} role="status">{note}</div>
    </div>
  );
}
