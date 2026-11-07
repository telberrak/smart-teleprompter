import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Script } from "../lib/script";
import { ScreenCard, type SlideView } from "./ScreenCard";
import { takes as io, mediaUrl, type ExportResult, type WhiteboardResult } from "../lib/bridge";
import { buildTimeline, slideSteps } from "../lib/storyboard";
import { bubblePngs, stepPng } from "../lib/slideImage";
import { CORNERS, isCorner, loadCorner, saveCorner, type Corner } from "../lib/bubble";
import { cues, toSrt } from "../lib/captions";
import { buildEdit, emptyReview, hiddenKey, timeline, totalSeconds, type Pick, type Segment, type TakeInfo } from "../lib/edit";
import { useReview } from "../lib/reviewState";
import { exportJob } from "../lib/exportJob";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

interface Props { script: Script; view: SlideView; scriptPath: string | null; onRedo: (i: number) => void }

/**
 * Every sentence with its recorded reads. The last read wins (click another to use it),
 * Redo re-records one sentence, Export writes the final cut with FFmpeg.
 */
export function Review({ script, view, scriptPath, onRedo }: Props) {
  const S = script.sentences;
  const [takes, setTakes] = useState<(TakeInfo & { error?: string })[]>([]);
  const [dir, setDir] = useState("");
  const [loading, setLoading] = useState(false);
  const { review, update: setReview } = useReview(scriptPath);
  const [sel, setSel] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [burn, setBurn] = useState(() => { try { return localStorage.getItem("tp.burn") === "1"; } catch { return false; } });
  const [error, setError] = useState("");
  const [wb, setWb] = useState<WhiteboardResult | null>(null);
  const flag = (k: string, dflt: boolean) => { try { const v = localStorage.getItem(k); return v === null ? dflt : v === "1"; } catch { return dflt; } };
  const [wbCaptions, setWbCaptions] = useState(() => flag("tp.wbcap", true));
  const [remotion, setRemotion] = useState(() => flag("tp.remotion", true));
  const [corner, setCornerRaw] = useState<Corner>(loadCorner);
  const setCorner = (c: Corner) => { setCornerRaw(c); saveCorner(c); };
  const videoRef = useRef<HTMLVideoElement>(null);
  const queue = useRef<{ segs: Segment[]; i: number } | null>(null);

  const load = useCallback(async () => {
    if (!io) return;
    setLoading(true); setError("");
    try { const r = await io.list(scriptPath); setTakes(r.takes); setDir(r.dir); }
    catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setLoading(false); }
  }, [scriptPath]);
  useEffect(() => { void load(); }, [load]);
  // Progress only for exports started here (Production's jobs report on the same channel).
  const busy = useRef(false);
  useEffect(() => io?.onExportProgress(x => { if (busy.current) setProgress(x); }), []);

  const edit = useMemo(() => buildEdit(takes, S.length, review.picks, review.hidden), [takes, S.length, review]);
  const lastTake = takes.reduce((a, t) => Math.max(a, t.take), 0);
  const pickOf = (n: number): Pick | undefined => { const p = review.picks[n]; return typeof p === "object" ? p : undefined; };
  const lockedOf = (i: number) => { const p = pickOf(i + 1), c = edit[i]?.chosen; return !!(p?.locked && c && c.id === p.read); };
  const use = (r: Segment) => setReview(s => ({ ...s, picks: { ...s.picks, [r.sentence]: { read: r.id!, at: lastTake, locked: lockedOf(r.sentence - 1) } } }));
  const toggleLock = (i: number) => {
    const c = edit[i]?.chosen;
    if (!c) return;
    const on = !lockedOf(i);
    setReview(s => ({ ...s, picks: { ...s.picks, [i + 1]: { read: c.id!, at: lastTake, locked: on } } }));
  };
  const lockAll = (on: boolean) => setReview(s => {
    const picks = { ...s.picks };
    edit.forEach((e, i) => { if (e.chosen) picks[i + 1] = { read: e.chosen.id!, at: lastTake, locked: on }; });
    return { ...s, picks };
  });
  const hide = (r: Segment) => setReview(s => {
    const picks = { ...s.picks };
    const p = picks[r.sentence];
    if (typeof p === "object" && p.read === r.id) delete picks[r.sentence];
    return { ...s, picks, hidden: [...s.hidden, hiddenKey(r)] };
  });
  const restoreRemoved = () => setReview(s => ({ ...s, hidden: [] }));
  const resetAll = async () => {
    if (!window.confirm("Reset all choices? Every sentence goes back to its latest read, locks are removed and removed reads come back. Your recordings are kept.")) return;
    setReview(() => emptyReview());
    if (io && takes.length && window.confirm(`Also delete all ${takes.length} recordings of this script? They go to the Recycle Bin.`)) {
      try { await io.remove(scriptPath, takes.map(t => t.file)); } catch (e) { setError(String((e as Error).message ?? e)); }
      void load();
    }
  };
  const deleteTake = async (t: TakeInfo) => {
    if (!io || !window.confirm(`Delete take ${t.take} (${fmt(t.seconds)})? It goes to the Recycle Bin; sentences recorded in it fall back to their other reads.`)) return;
    try { await io.remove(scriptPath, [t.file]); } catch (e) { setError(String((e as Error).message ?? e)); }
    void load();
  };
  const segs = useMemo(() => timeline(edit), [edit]);
  const recorded = segs.length;
  const rawSeconds = takes.reduce((a, t) => a + t.seconds, 0);

  // Preview: play one segment, or the whole cut in order.
  const play = (list: Segment[]) => {
    const v = videoRef.current;
    if (!v || !list.length) return;
    queue.current = { segs: list, i: 0 };
    start(v, list[0]);
  };
  const start = (v: HTMLVideoElement, s: Segment) => {
    setSel(s.sentence - 1);
    const go = () => { v.currentTime = s.start; void v.play(); };
    const url = mediaUrl(s.file);
    if (v.dataset.src !== url) { v.dataset.src = url; v.src = url; v.addEventListener("loadedmetadata", go, { once: true }); } else go();
  };
  const onTime = () => {
    const v = videoRef.current, q = queue.current;
    if (!v || !q) return;
    const s = q.segs[q.i];
    if (v.currentTime >= s.end) {
      if (q.i + 1 < q.segs.length) { q.i++; start(v, q.segs[q.i]); }
      else { v.pause(); queue.current = null; }
    }
  };

  const doExport = async () => {
    if (!io) return;
    if (exportJob.get()?.running) { setError("Production is exporting in the background: wait for it to finish (see the header)."); return; }
    setError(""); setResult(null); setProgress(0); busy.current = true;
    try { localStorage.setItem("tp.burn", burn ? "1" : "0"); } catch { /* private window */ }
    const srt = toSrt(cues(segs, n => S[n - 1]?.spoken ?? ""));
    try { setResult(await io.exportCut(scriptPath, segs, { srt, burn })); }
    catch (e) { setError(String((e as Error).message ?? e)); }
    finally { busy.current = false; setProgress(null); }
  };

  // Whiteboard video: slides full screen at each ON SCREEN step, camera in a round bubble, captions.
  const doWhiteboard = async () => {
    if (!io) return;
    if (exportJob.get()?.running) { setError("Production is exporting in the background: wait for it to finish (see the header)."); return; }
    setError(""); setWb(null); setProgress(0); busy.current = true;
    try { localStorage.setItem("tp.wbcap", wbCaptions ? "1" : "0"); localStorage.setItem("tp.remotion", remotion ? "1" : "0"); } catch { /* private window */ }
    try {
      const name = (st: number) => `step-${String(st).padStart(2, "0")}.png`;
      const timeline = buildTimeline(segs, script, { hasCamera: segs.some(s => s.video), video: "", image: name, corner });
      const images: Record<string, Uint8Array> = {};
      for (const st of slideSteps(timeline.scenes)) images[name(st)] = await stepPng(script, view, st);
      const { mask, ring } = await bubblePngs(360);
      setWb(await io.exportWhiteboard(scriptPath, segs, { timeline, images, mask, ring, srt: toSrt(timeline.captions), captions: wbCaptions, remotion }));
    } catch (e) { setError(String((e as Error).message ?? e)); }
    finally { busy.current = false; setProgress(null); }
  };

  const cur = sel !== null ? S[sel] : null;
  const step = S.slice(0, (sel ?? 0) + 1).reduce((a, s) => s.step ?? a, 0);

  return (
    <section className="screen on" id="review">
      <div className="panel">
        <div className="ph">
          <h2>Takes by sentence</h2>
          <span className="meta">
            {io ? <>{takes.length} take{takes.length === 1 ? "" : "s"} · {recorded} of {S.length} sentences recorded <button className="linkbtn" onClick={() => void load()} disabled={loading}>{loading ? "reading takes…" : "refresh"}</button></> : "recording and review work in the desktop app"}
          </span>
        </div>
        <div className="rv-tools">
          <button className="btn ghost" onClick={() => lockAll(true)} disabled={!recorded}>🔒 Lock all</button>
          <button className="btn ghost" onClick={() => lockAll(false)} disabled={!recorded}>🔓 Unlock all</button>
          <span className="pd-spacer" />
          {review.hidden.length > 0 && <button className="btn ghost" onClick={restoreRemoved} title="Bring back every read you removed with ×">Restore {review.hidden.length} removed read{review.hidden.length === 1 ? "" : "s"}</button>}
          <button className="btn ghost danger" onClick={() => void resetAll()}>Reset all…</button>
        </div>
        <div className="tl-head"><span className="label">#</span><span className="label">Sentence</span><span className="label">Reads (★ used, 🔒 locked, × remove)</span><span className="label">Lock</span><span className="label">Fix</span></div>
        <div className="tl">
          {S.map((s, i) => {
            const e = edit[i];
            return (
              <div className={"tr" + (e?.chosen ? "" : " missing") + (sel === i ? " sel" : "")} key={i}>
                <span className="no">{String(i + 1).padStart(2, "0")}</span>
                <span className="txt">{s.spoken}</span>
                <div className="takes">
                  {e?.reads.map((r, j) => {
                    const used = e.chosen === r;
                    const lk = used && lockedOf(i);
                    const same = e.reads.filter(x => x.take === r.take);
                    return (
                      <span key={j} className={"take" + (used ? " best" : "") + (lk ? " locked" : "")}>
                        <button className="pick" title={`Take ${r.take}, ${r.start.toFixed(1)}–${r.end.toFixed(1)} s · click to use and play`}
                          onClick={() => { use(r); play([r]); }}>
                          <span className="tm"><span>T{r.take}{same.length > 1 ? `·${same.indexOf(r) + 1}` : ""}{used && <span className="star"> {lk ? "🔒" : "★"}</span>}</span><span>{(r.end - r.start).toFixed(1)}s</span></span>
                        </button>
                        {!lk && <button className="x" title="Remove this read from the sentence (to delete a whole recording, use Recordings below)" aria-label={`Remove read T${r.take}`} onClick={() => hide(r)}>×</button>}
                      </span>
                    );
                  })}
                  {!e?.reads.length && <span className="none">not recorded yet</span>}
                </div>
                <button className={"lk" + (lockedOf(i) ? " on" : "")} onClick={() => toggleLock(i)} disabled={!e?.chosen} aria-pressed={lockedOf(i)}
                  title={lockedOf(i) ? "Locked: this read stays chosen, even after you record the sentence again. Click to unlock." : "Lock the chosen read so it stays chosen after a restart or a new recording"}>
                  {lockedOf(i) ? "🔒" : "🔓"}</button>
                <button className="rr" onClick={() => onRedo(i)} title={lockedOf(i) ? "Record this sentence again (it is locked: unlock to use the new read)" : "Record this sentence again"}><i />Redo</button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="panel">
        <div className="ph"><h2>Final cut</h2><span className="meta">{fmt(totalSeconds(segs))} from {fmt(rawSeconds)} recorded</span></div>
        <div className="preview">
          <div className="frame player">
            <video ref={videoRef} onTimeUpdate={onTime} playsInline controls={false} />
            {!videoRef.current?.dataset.src && <div className="pv-empty">Click a read to play it, or play the whole cut.</div>}
          </div>
          {cur && <div className="pv-line"><b>{String((sel ?? 0) + 1).padStart(2, "0")}</b> {cur.spoken}</div>}
          <div className="vs-btns">
            {(() => {
              // From the highlighted sentence (or the next one that is in the cut).
              const from = sel === null ? 0 : Math.max(0, segs.findIndex(x => x.sentence >= sel + 1));
              const at = segs.length && from > 0 ? String(segs[from].sentence).padStart(2, "0") : "";
              return <>
                <button className="btn" onClick={() => play(segs.slice(from))} disabled={!segs.length}
                  title="Play the cut from the highlighted sentence">▶ Play the cut{at ? ` from ${at}` : ""}</button>
                {at && <button className="btn ghost" onClick={() => play(segs)} title="Play the whole cut from the beginning">From the start</button>}
              </>;
            })()}
            <button className="btn ghost" onClick={() => { videoRef.current?.pause(); queue.current = null; }}>Pause</button>
          </div>
          <div className="mini-slide"><ScreenCard script={script} view={view} step={step} /></div>
          <span className="label">Export</span>
          <button className="btn primary" onClick={() => void doExport()} disabled={!segs.length || progress !== null}>
            {progress !== null ? `Exporting… ${Math.round(progress * 100)}%` : `Export MP4 (${segs.length} sentences)`}
          </button>
          {progress !== null && <div className="vsetup"><div className="bar"><b style={{ width: `${Math.round(progress * 100)}%` }} /></div></div>}
          <label className="row" htmlFor="burn">Also make a copy with captions burnt in <input type="checkbox" className="switch" id="burn" checked={burn} onChange={e => setBurn(e.target.checked)} /></label>
          {result?.srt && <div className="out"><span className="ext">SRT</span><span className="f">{result.srt.split(/[\\/]/).pop()} · captions from your script</span><button className="linkbtn" onClick={() => void io?.reveal(result.srt!)}>Show file</button></div>}
          {result?.captioned && <div className="out"><span className="ext">MP4</span><span className="f">{result.captioned.split(/[\\/]/).pop()}</span><button className="linkbtn" onClick={() => void io?.reveal(result.captioned!)}>Show file</button></div>}
          {result?.captionError && <div className="vsetup err">Burning in captions failed: {result.captionError}</div>}
          {result && <div className="out"><span className="ext">MP4</span><span className="f" title={result.file}>{result.file.split(/[\\/]/).pop()} · {fmt(result.seconds)}</span><button className="linkbtn" onClick={() => void io?.reveal(result.file)}>Show file</button></div>}
          <span className="label">Whiteboard video</span>
          <span className="small-note">Slides full screen at each ON SCREEN note, your camera in a round bubble in the corner you choose; the cold open stays on camera.</span>
          <button className="btn primary" onClick={() => void doWhiteboard()} disabled={!segs.length || progress !== null}>
            {progress !== null ? `Exporting… ${Math.round(progress * 100)}%` : "Make whiteboard video"}
          </button>
          <label className="row" htmlFor="wbcorner">Camera bubble
            <select id="wbcorner" className="micsel" value={corner} onChange={e => isCorner(e.target.value) && setCorner(e.target.value)}>
              {CORNERS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="row" htmlFor="wbcap">Captions on the whiteboard video <input type="checkbox" className="switch" id="wbcap" checked={wbCaptions} onChange={e => setWbCaptions(e.target.checked)} /></label>
          <label className="row" htmlFor="remotion">Also write a Remotion project <input type="checkbox" className="switch" id="remotion" checked={remotion} onChange={e => setRemotion(e.target.checked)} /></label>
          {wb && <div className="out"><span className="ext">MP4</span><span className="f" title={wb.file}>{wb.file.split(/[\\/]/).pop()} · {fmt(wb.seconds)}</span><button className="linkbtn" onClick={() => void io?.reveal(wb.file)}>Show file</button></div>}
          {wb && <div className="out"><span className="ext">JSON</span><span className="f" title={wb.timeline}>{wb.timeline.split(/[\\/]/).pop()} · timeline</span><button className="linkbtn" onClick={() => void io?.reveal(wb.timeline)}>Show file</button></div>}
          {wb?.remotion && <div className="out"><span className="ext">TSX</span><span className="f" title={wb.remotion}>{wb.remotion.split(/[\\/]/).pop()} · Remotion project</span><button className="linkbtn" onClick={() => void io?.reveal(wb.remotion!)}>Show folder</button></div>}
          {wb?.remotion && <span className="small-note">In that folder: <code>npm install</code>, then <code>npm run studio</code> to edit or <code>npm run render</code>.</span>}
          {wb?.remotionError && <div className="vsetup err">Remotion project failed: {wb.remotionError}</div>}
          {error && <div className="vsetup err">{error}</div>}
          <span className="label">Recordings</span>
          <div className="rv-takes">
            {[...takes].sort((a, b) => a.take - b.take).map(t => (
              <div key={t.file} className="out"><span className="ext">T{t.take}</span><span className="f" title={t.file}>{fmt(t.seconds)} · {new Set(t.sentences.map(m => m.sentence)).size} sentences{t.error ? " · " + t.error : ""}</span>
                <button className="linkbtn" onClick={() => void io?.reveal(t.file)}>Show</button>
                <button className="linkbtn danger" onClick={() => void deleteTake(t)}>Delete</button></div>
            ))}
            {!takes.length && <span className="small-note">No recordings yet.</span>}
          </div>
          {dir && <span className="small-note">Takes folder: {dir}</span>}
        </div>
      </div>
    </section>
  );
}
