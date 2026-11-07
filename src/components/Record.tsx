import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Script } from "../lib/script";
import { ScreenCard, type SlideView } from "./ScreenCard";
import { BREATH } from "../lib/script";
import { Words } from "./Words";
import { EditableLine } from "./EditableLine";
import { voice, inElectron, type VoiceStatus } from "../lib/bridge";
import { startMic, type Mic } from "../lib/mic";
import { align, heardWords, norm } from "../lib/align";

interface Props {
  script: Script;
  view: SlideView;
  startAt: number;
  onEdit: (index: number, source: string) => void;
}

const EYE_LINE = 140; // px from the top of the prompter: just under the camera
const WB_EYE_LINE = 64; // whiteboard mode: first line under the slide, one faded line above

type Mode = "prompter" | "whiteboard";
type Source = "sim" | "mic";
const loadSource = (): Source => { try { return inElectron && localStorage.getItem("tp.voice") === "mic" ? "mic" : "sim"; } catch { return "sim"; } };
const loadMode = (): Mode => { try { return localStorage.getItem("tp.mode") === "whiteboard" ? "whiteboard" : "prompter"; } catch { return "prompter"; } };

/**
 * Full-screen prompter. Milestone 1 simulates the voice with a steady reading pace;
 * milestone 2 replaces the timer with whisper.cpp + the live aligner.
 */
export function Record({ script, view, startAt, onEdit }: Props) {
  const S = script.sentences;
  const offsets = useMemo(() => {
    const o: number[] = []; let n = 0;
    for (const s of S) { o.push(n); n += s.tokens.filter(t => t.type === "word").length; }
    return { first: o, total: n };
  }, [S]);
  const sentenceOf = useCallback((w: number) => {
    let i = 0; while (i + 1 < S.length && offsets.first[i + 1] <= w) i++; return i;
  }, [S, offsets]);
  /** What follows word w before the next word: a / breath, and seconds of [pause] marks. */
  const after = (w: number) => {
    const out = { breath: false, pause: 0 };
    if (w < 0) return out;
    const s = S[sentenceOf(w)]; let n = offsets.first[s.index] - 1; let found = false;
    for (const t of s.tokens) {
      if (t.type === "word") { if (found) break; if (++n === w) found = true; continue; }
      if (!found) continue;
      if (t.type === "breath") out.breath = true;
      if (t.type === "pause") out.pause += t.secs;
    }
    return out;
  };

  const [cur, setCur] = useState(() => ({ s: startAt, w: (offsets.first[startAt] ?? 0) - 1 }));
  const [live, setLive] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [pausesDone, setPausesDone] = useState<Set<number>>(new Set());
  const [pausing, setPausing] = useState<number | null>(null);
  const [recT, setRecT] = useState(0);
  const [take, setTake] = useState(1);
  const [mirror, setMirror] = useState(false);
  const [mode, setModeRaw] = useState<Mode>(loadMode);
  const wb = mode === "whiteboard";
  const setMode = useCallback((m: Mode) => { setModeRaw(m); try { localStorage.setItem("tp.mode", m); } catch { /* private window */ } }, []);
  const [fsP, setFsP] = useState(46);
  const [fsW, setFsW] = useState(34);
  const fs = wb ? fsW : fsP;
  const setFs = wb ? setFsW : setFsP;
  const [toastMsg, setToastMsg] = useState("");
  const [levels, setLevels] = useState<number[]>(Array(16).fill(0));
  const [wpm, setWpm] = useState(0);
  const phase = useRef(0);
  const [source, setSourceRaw] = useState<Source>(loadSource);
  const setSource = (v: Source) => { setSourceRaw(v); try { localStorage.setItem("tp.voice", v); } catch { /* private window */ } };
  const [vs, setVs] = useState<VoiceStatus | null>(null);
  const [heard, setHeard] = useState("");
  const mic = source === "mic";
  const micReady = mic && vs?.phase === "ready";
  const curRef = useRef(cur); curRef.current = cur;
  // Every word of the script in order, as the aligner sees it (same numbering as the word offsets).
  const words = useMemo(() => {
    const raw: string[] = [];
    for (const s of S) for (const t of s.tokens) if (t.type === "word") raw.push(t.text.replace(/\*/g, ""));
    return { raw, norm: raw.map(norm) };
  }, [S]);
  const promptRef = useRef<HTMLDivElement>(null);

  const toast = useCallback((m: string) => setToastMsg(m), []);
  useEffect(() => { if (!toastMsg) return; const t = setTimeout(() => setToastMsg(""), 2800); return () => clearTimeout(t); }, [toastMsg]);

  // Start position from Review's "Redo"
  useEffect(() => { setCur({ s: startAt, w: (offsets.first[startAt] ?? 0) - 1 }); }, [startAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Simulated voice: advance one word at a time at a natural pace.
  useEffect(() => {
    if (!live || editing !== null || mic) return;
    const next = cur.w + 1;
    if (next >= offsets.total) { setLive(false); toast(`Take ${take} complete · ${S.length} of ${S.length} sentences`); return; }
    const nextS = sentenceOf(next);
    const a = after(cur.w);
    if (a.pause && !pausesDone.has(cur.w)) {
      setPausing(cur.w);
      const t = setTimeout(() => { setPausing(null); setPausesDone(d => new Set(d).add(cur.w)); }, a.pause * 1000);
      return () => clearTimeout(t);
    }
    phase.current += 0.18;
    const pace = script.wpm + Math.sin(phase.current) * script.wpm * 0.12;
    const delay = 60000 / pace + (a.breath ? BREATH * 1000 : 0);
    const t = setTimeout(() => setCur({ w: next, s: nextS }), cur.w < 0 ? 300 : delay);
    return () => clearTimeout(t);
  }, [live, cur, editing, pausesDone, mic]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recording clock and meters
  useEffect(() => {
    if (!live) { setLevels(Array(16).fill(0)); setWpm(0); return; }
    const clock = setInterval(() => setRecT(t => t + 1), 1000);
    if (mic) return () => clearInterval(clock);
    const meter = setInterval(() => {
      const amp = pausing !== null ? 0.05 : 0.45 + Math.random() * 0.5;
      setLevels(Array.from({ length: 16 }, (_, i) => (i / 16 < amp ? 1 : 0)));
      setWpm(pausing !== null ? 0 : Math.round(script.wpm + Math.sin(phase.current) * script.wpm * 0.12));
    }, 140);
    return () => { clearInterval(clock); clearInterval(meter); };
  }, [live, pausing, script.wpm, mic]);

  // Voice engine status (desktop app only)
  useEffect(() => {
    if (!voice) return;
    let alive = true;
    void voice.status().then(st => { if (alive) setVs(st); });
    const off = voice.onState(setVs);
    return () => { alive = false; off(); };
  }, []);
  // Choosing the microphone loads the model straight away when it is already downloaded.
  useEffect(() => {
    if (mic && voice && vs && vs.model && vs.engine && vs.phase === "idle") void voice.setup().then(setVs);
  }, [mic, vs]);

  // Real voice: listen, transcribe the last 4 s again and again, and move to where you are.
  useEffect(() => {
    if (!live || !micReady || editing !== null || !voice) return;
    const v = voice;
    let m: Mic | null = null, stopped = false, inflight = false;
    const hist: { t: number; w: number }[] = [];
    startMic().then(x => { if (stopped) x.stop(); else m = x; })
      .catch(err => { toast(`Microphone not available: ${err?.message ?? err}`); setLive(false); });
    const meter = setInterval(() => {
      if (!m) return;
      const amp = m.level();
      setLevels(Array.from({ length: 16 }, (_, i) => (i / 16 < amp ? 1 : 0)));
    }, 100);
    const listen = setInterval(async () => {
      if (!m || inflight || m.quietFor() > 1.2) return;
      inflight = true;
      try {
        const pos = curRef.current.w;
        // Tell whisper what is coming: it then spells your words the way the script does.
        const prompt = words.raw.slice(Math.max(0, pos - 15), pos + 35).join(" ");
        const res = await v.transcribe(m.last(4), prompt);
        if (stopped || !res) return;
        if (res.error) { toast(`Speech engine: ${res.error}`); return; }
        setHeard(res.text.trim());
        const hit = align(words.norm, curRef.current.w, heardWords(res.text));
        if (hit && hit.pos !== curRef.current.w) {
          setCur({ w: hit.pos, s: sentenceOf(hit.pos) });
          const now = performance.now();
          hist.push({ t: now, w: hit.pos });
          while (hist.length > 2 && now - hist[0].t > 10000) hist.shift();
          if (hist.length > 1) {
            const dt = (now - hist[0].t) / 60000, dw = hit.pos - hist[0].w;
            if (dt > 0.03 && dw > 0) setWpm(Math.round(dw / dt));
          }
        }
      } finally { inflight = false; }
    }, 350);
    return () => {
      stopped = true; clearInterval(meter); clearInterval(listen); m?.stop();
      setLevels(Array(16).fill(0)); setWpm(0);
    };
  }, [live, micReady, editing, words, sentenceOf, toast]);

  const toggleLive = useCallback(() => {
    if (!live && mic && !micReady) { toast(vs?.model ? "The speech model is still loading…" : "Download the speech model first (Prompter panel)"); return; }
    setLive(l => !l);
  }, [live, mic, micReady, vs, toast]);

  // Keep the current sentence on the eye line
  useLayoutEffect(() => {
    const el = promptRef.current?.querySelector<HTMLElement>(`.pl[data-s="${cur.s}"]`);
    if (el && promptRef.current) promptRef.current.style.transform = `translateY(${(wb ? WB_EYE_LINE : EYE_LINE) - el.offsetTop}px)`;
  }, [cur.s, fs, S, editing, wb]);

  const startEdit = useCallback((i: number) => { setLive(false); setPausing(null); setEditing(i); }, []);
  const saveEdit = (i: number, v: string) => {
    onEdit(i, v);
    setEditing(null);
    setCur({ s: i, w: (offsets.first[i] ?? 0) - 1 });
    toast(`Saved to the script · press Space to go on from sentence ${i + 1}`);
  };
  const back = useCallback(() => {
    const atStart = cur.w <= offsets.first[cur.s];
    const s = Math.max(0, cur.s - (atStart ? 1 : 0));
    setCur({ s, w: offsets.first[s] - 1 });
    setPausesDone(d => new Set([...d].filter(w => w < offsets.first[s])));
    toast(`Back to sentence ${s + 1}`);
  }, [cur, offsets, toast]);
  const restart = () => {
    setLive(false); setCur({ s: 0, w: -1 }); setRecT(0); setPausesDone(new Set()); setPausing(null); setTake(t => t + 1);
  };
  const jump = (s: number) => { setCur({ s, w: offsets.first[s] - 1 }); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing !== null || (e.target as HTMLElement).tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); toggleLive(); }
      else if (e.key === "ArrowLeft") back();
      else if (e.key === "e" || e.key === "E") { e.preventDefault(); startEdit(cur.s); }
      else if (e.key === "m" || e.key === "M") setMirror(m => !m);
      else if (e.key === "w" || e.key === "W") setMode(wb ? "prompter" : "whiteboard");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, back, startEdit, cur.s, wb, setMode, toggleLive]);

  const step = S.slice(0, cur.s + 1).reduce((a, s) => s.step ?? a, 0);
  const maxStep = Math.max(0, ...S.map(s => s.step ?? 0));
  // Pace dial centred on the script's own target speed
  const pos = Math.max(2, Math.min(98, 50 + ((wpm - script.wpm) / script.wpm) * 160));
  const paceLabel = !wpm ? "idle" : wpm > script.wpm * 1.15 ? "too fast" : wpm < script.wpm * 0.8 ? "slow" : "good";
  const mmss = `${String(Math.floor(recT / 60)).padStart(2, "0")}:${String(recT % 60).padStart(2, "0")}`;

  return (
    <section className={"screen on" + (wb ? " wb" : "")} id="record">
      <div className={"stage" + (live ? " live" : "") + (mirror ? " mirrored" : "") + (wb ? " wb" : "")}>
        <div className="notch" aria-hidden="true"><span className="lens" /></div>
        {wb
          ? <div className="wb-slide"><div className="slide"><ScreenCard script={script} view={view} step={step} ghost /></div><span className="wb-step">step {step} / {maxStep}</span></div>
          : <div className="eyeline" aria-hidden="true" />}
        <div className={"toast" + (toastMsg ? " show" : "")} role="status"><span className="dot" /><span>{toastMsg}</span></div>
        {editing !== null && <div className="edit-hint">Editing sentence {editing + 1} · <kbd>Enter</kbd> save · <kbd>Esc</kbd> cancel · use **word** for stress and / for a breath</div>}
        <div className="prompt-viewport">
          {wb && <div className="wb-eye" style={{ top: WB_EYE_LINE - 8, height: fs * 1.32 + 16 }} aria-hidden="true" />}
          <div className="prompt" ref={promptRef} style={{ ["--fs" as string]: fs + "px" }}>
            {S.map(s => {
              const rel = s.index < cur.s ? "past" : s.index === cur.s ? "cur" : s.index === cur.s + 1 ? "next" : "later";
              return (<div key={s.index}>
                {s.section && s.section !== S[s.index - 1]?.section && <div className="pl-sec">{s.section}</div>}
                <p className={`pl k-${s.kind} ${rel}${editing === s.index ? " editing" : ""}`} data-s={s.index}
                   onClick={() => editing === null && startEdit(s.index)} title="Click to edit this sentence">
                  {editing === s.index
                    ? <EditableLine value={s.source} onSave={v => saveEdit(s.index, v)} onCancel={() => setEditing(null)} />
                    : <>
                        <Words s={s} wordClass="w" offset={offsets.first[s.index]} said={s.index === cur.s ? cur.w : -1} now={s.index === cur.s ? cur.w : -1}
                          pauseFill={w => pausing === w ? { width: "100%", transition: `width ${after(w).pause}s linear` } : pausesDone.has(w) ? { width: "100%" } : undefined} />
                        {s.step && <span className="oncue">◆ step {s.step}</span>}
                      </>}
                </p></div>
              );
            })}
          </div>
        </div>
        <div className="strip">
          <div className="cam"><span className="rec"><i />{mmss}</span></div>
          <div className="meters">
            <div className="meter"><span className="label">Mic</span>
              <div className="level">{levels.map((on, i) => { const f = i / 16; return <i key={i} className={on ? (f > 0.85 ? "x" : f > 0.65 ? "h" : "") : ""} style={{ height: on ? 6 + f * 16 : 3, opacity: on ? 1 : 0.25 }} />; })}</div>
            </div>
            <div className="meter"><span className="label">Pace · {paceLabel} · target {script.wpm}</span><div className="speed"><b style={{ left: (wpm ? pos : 2) + "%" }} /></div></div>
            <div className="meter"><span className="label">Words / min</span><span className="mono big">{wpm || "—"}</span></div>
            <div className="meter"><span className="label">Take</span><span className="mono big">{take}</span></div>
            <span className="sim" title={heard}>{mic ? (heard ? `heard: “${heard.length > 40 ? "…" + heard.slice(-40) : heard}”` : "listening to your voice") : "voice simulated"}</span>
          </div>
          <div className="ctrls">
            <button className="btn ghost" onClick={back} title="Back one sentence (←)">↶ Back</button>
            <button className="recbtn" onClick={toggleLive} aria-label="Start or stop recording (Space)"><i /></button>
            <button className="btn ghost" onClick={restart} title="Restart from the top">⟲ Restart</button>
          </div>
        </div>
      </div>

      <div className="side">
        {!wb && <div className="panel">
          <div className="ph"><h2>On screen now</h2><span className="meta">step {step} / {maxStep}</span></div>
          <div className="mini"><div className="slide"><ScreenCard script={script} view={view} step={step} ghost /></div></div>
        </div>}
        <div className="panel">
          <div className="ph"><h2>Prompter</h2></div>
          <div className="mini">
            <div className="row">Mode
              <span className="seg" role="group" aria-label="Prompter mode">
                <button className={!wb ? "on" : ""} aria-pressed={!wb} onClick={() => setMode("prompter")}>Prompter</button>
                <button className={wb ? "on" : ""} aria-pressed={wb} onClick={() => setMode("whiteboard")}>Whiteboard</button>
              </span>
            </div>
            <div className="row">Voice
              <span className="seg" role="group" aria-label="What moves the text">
                <button className={!mic ? "on" : ""} aria-pressed={!mic} onClick={() => setSource("sim")}>Simulated</button>
                <button className={mic ? "on" : ""} aria-pressed={mic} disabled={!voice} title={voice ? "Follow your real voice (offline, whisper.cpp)" : "Microphone works in the desktop app"} onClick={() => setSource("mic")}>Microphone</button>
              </span>
            </div>
            {mic && vs && <VoiceSetup vs={vs} onSetup={() => voice && void voice.setup().then(setVs)} onPick={() => voice && void voice.pickModel().then(setVs)} />}
            <label className="row" htmlFor="mirror">Mirror for glass <input type="checkbox" className="switch" id="mirror" checked={mirror} onChange={e => setMirror(e.target.checked)} /></label>
            <label className="row" htmlFor="fs">Text size <input type="range" id="fs" min={wb ? 22 : 30} max={wb ? 48 : 64} value={fs} onChange={e => setFs(+e.target.value)} /></label>
            <div className="row">Shortcuts <span><kbd>Space</kbd> <kbd>←</kbd> <kbd>E</kbd> <kbd>M</kbd> <kbd>W</kbd></span></div>
          </div>
        </div>
        <div className="panel">
          <div className="ph"><h2>Sentences</h2><span className="meta">{S.length} total</span></div>
          <div className="mini"><div className="sent-list">
            {S.map(s => (
              <div key={s.index} className={s.index < cur.s ? "done" : s.index === cur.s ? "cur" : ""} onClick={() => jump(s.index)} style={{ cursor: "pointer" }}>
                <span>{s.index + 1}</span><span>{s.spoken.length > 48 ? s.spoken.slice(0, 48) + "…" : s.spoken}</span>
              </div>
            ))}
          </div></div>
        </div>
      </div>
    </section>
  );
}

/** First-run setup for the speech model, and its status afterwards. */
function VoiceSetup({ vs, onSetup, onPick }: { vs: VoiceStatus; onSetup: () => void; onPick: () => void }) {
  if (!vs.engine) return <div className="vsetup err">{vs.engineError}</div>;
  if (vs.phase === "ready") return <div className="vsetup ok">● Listening engine ready · {vs.modelName}</div>;
  if (vs.phase === "downloading" || vs.phase === "loading")
    return <div className="vsetup"><span>{vs.message}</span><div className="bar"><b style={{ width: `${Math.round(vs.progress * 100)}%` }} /></div></div>;
  return (
    <div className="vsetup">
      {vs.phase === "error" && <span className="err">{vs.message}</span>}
      {!vs.model && <span>Following your voice needs a speech model (148 MB, downloaded once, then fully offline).</span>}
      <div className="vs-btns">
        <button className="btn" onClick={onSetup}>{vs.model ? "Load the speech model" : "Download speech model"}</button>
        <button className="btn ghost" onClick={onPick} title="Use a ggml-*.bin file you already have">Use a model file…</button>
      </div>
    </div>
  );
}
