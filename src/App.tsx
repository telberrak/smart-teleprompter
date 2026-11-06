import { useCallback, useEffect, useMemo, useState } from "react";
import sample from "./sample/1.3-whiteboard-script.md?raw";
import { parseScript, replaceSentence } from "./lib/script";
import { inElectron, openScript, saveScript } from "./lib/bridge";
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
  const script = useMemo(() => parseScript(md), [md]);

  useEffect(() => { history.replaceState(null, "", "#" + screen); }, [screen]);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(""), 2800); return () => clearTimeout(t); }, [note]);

  const open = async () => {
    const f = await openScript();
    if (!f) return;
    setMd(f.content); setFile({ path: f.path, name: f.name }); setStartAt(0); setScreen("prepare");
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
    <div className="app">
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
      {screen === "prepare" && <Prepare script={script} fileName={file.name} saved={!!file.path} onOpen={open} onEdit={edit} onRecord={() => { setStartAt(0); setScreen("record"); }} />}
      {screen === "record" && <Record script={script} startAt={startAt} onEdit={edit} />}
      {screen === "review" && <Review script={script} onRedo={i => { setStartAt(Math.max(0, i - 2)); setScreen("record"); }} />}
      <div className={"gtoast" + (note ? " show" : "")} role="status">{note}</div>
    </div>
  );
}
