import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { Script } from "../lib/script";
import type { SlideView } from "./ScreenCard";
import { takes as io, mediaUrl, type ProductionResult } from "../lib/bridge";
import { buildEdit, timeline, type Segment, type TakeInfo } from "../lib/edit";
import { useReview } from "../lib/reviewState";
import { refit } from "../lib/production";
import { cues, toSrt } from "../lib/captions";
import { loadCorner, CORNERS, type Corner } from "../lib/bubble";
import { bubblePngs, stepPng } from "../lib/slideImage";
import { drawCaption, drawTitle, shortHeaderPng, thumbnailPng, titlePng } from "../lib/titleArt";
import { SHORT_LAYOUT, SHORT_MAX, captionYAt, shortAss, shortCues, shortPieces, shortSeconds, stressedWords, suggestShort } from "../lib/short";
import {
  TRACKS, DEFAULT_BRAND, add, at, buildProduction, chapters, clipsOn, cutKey, description, move, proChecks, remove, snap, snapPoints, split, update,
  type Brand, type Clip, type Production as Prod, type TitleKind, type TrackId,
} from "../lib/production";

interface Props { script: Script; view: SlideView; scriptPath: string | null }

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const fmtMs = (s: number) => `${fmt(s)}.${Math.floor((s % 1) * 10)}`;
const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } },
};
const TITLE_NAMES: Record<TitleKind, string> = { title: "Title card", lower: "Lower third", chapter: "Chapter card", term: "Key term", outro: "Outro" };
const CLIP_COLOURS: Record<TrackId, string> = { titles: "k-title", camera: "k-cam", slides: "k-slide", voice: "k-voice", music: "k-music", sfx: "k-sfx", captions: "k-cap" };

function clipLabel(c: Clip): string {
  switch (c.track) {
    case "titles": return `${TITLE_NAMES[c.kind]}: ${c.text}`;
    case "camera": return c.layout === "full" ? "Camera full screen" : c.layout === "bubble" ? `Camera bubble · ${CORNERS.find(x => x.id === c.corner)?.label.toLowerCase()}` : "Camera hidden";
    case "slides": return `Step ${c.step}${c.motion === "zoom" ? " · slow zoom" : ""}${c.corner ? " · bubble " + CORNERS.find(x => x.id === c.corner)?.label.toLowerCase() : ""}`;
    case "voice": return `Voice${c.clean ? " · cleaned" : ""} · ${c.loudness} LUFS`;
    case "music": return `Music · ${c.file.split(/[\\/]/).pop()} · ${c.duck === "off" ? "no ducking" : "ducks under voice"}`;
    case "sfx": return c.sound;
    case "captions": return c.style === "off" ? "Captions off" : `Captions · ${c.style}`;
  }
}

/**
 * Production: the finished lesson on a timeline. Built from Review's cut the first time,
 * then edited here: titles, camera layout, slide motion, music, sound effects, captions.
 */
export function Production({ script, view, scriptPath }: Props) {
  const S = script.sentences;
  const [takes, setTakes] = useState<TakeInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const { review, ready: reviewReady } = useReview(scriptPath);
  const segs: Segment[] = useMemo(() => (reviewReady ? timeline(buildEdit(takes, S.length, review.picks, review.hidden)) : []), [takes, S.length, review, reviewReady]);
  const hasCamera = segs.some(s => s.video);
  const key = cutKey(segs);
  const [brand, setBrandRaw] = useState<Brand>(() => ({ ...DEFAULT_BRAND, ...store.get<Partial<Brand>>("tp.brand", {}) }));
  const [prod, setProdRaw] = useState<Prod | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [cut, setCut] = useState<{ file: string; seconds: number } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [tab, setTab] = useState<"media" | "text" | "audio" | "brand">("text");
  const [pane, setPane] = useState<"edit" | "export">("edit");
  const [zoomSet, setZoom] = useState(() => store.get("tp.zoom", 0)); // px per second; 0 = fit the video to the width
  const lanesRef = useRef<HTMLDivElement>(null);
  const [laneW, setLaneW] = useState(900);
  useEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLaneW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  });
  const [magnet, setMagnet] = useState(true);
  const [result, setResult] = useState<ProductionResult | null>(null);
  const [outs, setOuts] = useState(() => store.get("tp.outs", { mp4: true, srt: true, txt: true, png: true, short: false }));
  const [shortFile, setShortFile] = useState<string | null>(null);
  const [thumb, setThumb] = useState<{ step: number; at: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const zoom = zoomSet || Math.max(0.5, (laneW - 20) / Math.max(1, prod?.seconds ?? 60));
  const musicRef = useRef<HTMLAudioElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const slideUrls = useRef(new Map<number, string>());
  const [, bump] = useState(0);

  const setProd = useCallback((p: Prod | ((q: Prod) => Prod)) => {
    setProdRaw(q => { const next = typeof p === "function" ? (q ? p(q) : q) : p; if (next) store.set("tp.prod:" + scriptPath, next); return next; });
  }, [scriptPath]);
  const setBrand = (b: Brand) => { setBrandRaw(b); store.set("tp.brand", b); setProd(p => ({ ...p, brand: b })); };

  // Takes → cut → production (rebuilt when the cut changed in Review).
  useEffect(() => {
    if (!io) { setLoaded(true); return; }
    io.list(scriptPath).then(r => setTakes(r.takes)).catch(e => setError(String(e?.message ?? e))).finally(() => setLoaded(true));
  }, [scriptPath]);
  // Nothing is built on its own: the cut and the timeline are rebuilt only when you click.
  const [cutState, setCutState] = useState<"checking" | "fresh" | "stale" | "missing">("checking");
  const [building, setBuilding] = useState(false);
  useEffect(() => {
    if (!loaded || !segs.length) return;
    const saved = store.get<Prod | null>("tp.prod:" + scriptPath, null);
    setProdRaw(saved ?? buildProduction(segs, script, { hasCamera, corner: loadCorner(), brand }));
    if (!io) return;
    setCutState("checking");
    io.cutStatus(scriptPath, segs).then(st => {
      setCut(st ? { file: st.file, seconds: st.seconds } : null);
      setCutState(!st ? "missing" : st.fresh ? "fresh" : "stale");
    }).catch(() => setCutState("missing"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, key, scriptPath]);
  const busy = useRef(false);
  useEffect(() => io?.onExportProgress(x => { if (busy.current) setProgress(x); }), []);
  const needsRebuild = !!prod && (prod.cutKey !== key || cutState === "stale" || cutState === "missing");
  const doRebuild = async () => {
    if (!io || !prod || busy.current) return;
    busy.current = true; setBuilding(true); setProgress(0); setError("");
    try {
      const c = await io.productionCut(scriptPath, segs);
      setCut(c); setCutState("fresh");
      if (prod.cutKey !== key) setProd(q => refit(q, buildProduction(segs, script, { hasCamera, corner: loadCorner(), brand: q.brand })));
    } catch (e) { setError(String((e as Error).message ?? e)); }
    finally { busy.current = false; setBuilding(false); setProgress(null); }
  };

  // Slide pictures, drawn once per step (the same pictures the export uses).
  useEffect(() => {
    if (!prod) return;
    let gone = false;
    (async () => {
      for (const s of clipsOn(prod, "slides")) {
        if (slideUrls.current.has(s.step) || gone) continue;
        const png = await stepPng(script, view, s.step);
        slideUrls.current.set(s.step, URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: "image/png" })));
        bump(x => x + 1);
      }
    })();
    return () => { gone = true; };
  }, [prod, script, view]);
  useEffect(() => () => { slideUrls.current.forEach(u => URL.revokeObjectURL(u)); slideUrls.current.clear(); }, [script, view]);

  // Playback clock: the cut video drives the time.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => { const v = videoRef.current; if (v) setT(v.currentTime); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  const seek = (x: number) => {
    const s = Math.max(0, Math.min(prod?.seconds ?? 0, x));
    setT(s);
    if (videoRef.current) videoRef.current.currentTime = s;
    if (musicRef.current) musicRef.current.currentTime = s;
  };
  const togglePlay = () => {
    const v = videoRef.current, m = musicRef.current;
    if (!v) return;
    if (playing) { v.pause(); m?.pause(); setPlaying(false); }
    else { v.currentTime = t; void v.play(); if (m) { m.currentTime = t; void m.play(); } setPlaying(true); }
  };

  const capList = useMemo(() => cues(segs, n => S[n - 1]?.spoken ?? ""), [segs, S]);
  const now = prod ? at(prod, t) : null;

  // Titles and captions over the picture, drawn the way they will be exported.
  useEffect(() => {
    const c = overlayRef.current;
    if (!c || !prod) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const ti of at(prod, t).titles) drawTitle(ctx, ti, prod.brand, Math.min(1, (t - ti.start) / 0.35, (ti.end - t) / 0.35));
    const cap = clipsOn(prod, "captions")[0];
    const cue = capList.find(q => t >= q.start && t < q.end);
    if (cap && cap.style !== "off" && cue) drawCaption(ctx, cue, cap.style);
  }, [t, prod, capList]);

  // Music volume in the preview (ducking is only heard in the export).
  const music = prod ? clipsOn(prod, "music")[0] : undefined;
  useEffect(() => { if (musicRef.current && music) musicRef.current.volume = Math.min(1, Math.pow(10, music.volume / 20)); }, [music]);

  const selected = prod?.clips.find(c => c.id === sel) ?? null;
  const patch = (p: Partial<Clip>) => sel && setProd(q => update(q, sel, p));
  const addTitle = (kind: TitleKind) => {
    if (!prod) return;
    const d = kind === "outro" ? 5 : kind === "chapter" ? 3 : 5;
    const start = Math.min(t, prod.seconds - d);
    const text = kind === "title" ? script.title : kind === "lower" ? brand.name : kind === "outro" ? brand.outro : kind === "term" ? "Term" : "Chapter";
    const sub = kind === "lower" || kind === "title" ? brand.course : kind === "term" ? "One-line definition" : kind === "outro" ? script.title : "";
    const next = add(prod, { track: "titles", kind, start, end: start + d, text, sub } as Omit<Clip, "id">);
    setProd(next); setSel(next.clips.at(-1)!.id);
  };
  const addSfx = (sound: "whoosh" | "pop") => {
    if (!prod) return;
    const next = add(prod, { track: "sfx", sound, volume: -18, start: t, end: Math.min(prod.seconds, t + 0.8) } as Omit<Clip, "id">);
    setProd(next); setSel(next.clips.at(-1)!.id);
  };
  const pickMusic = async () => {
    if (!io || !prod) return;
    const file = await io.pickMusic();
    if (!file) return;
    const old = clipsOn(prod, "music")[0];
    const base = old ? remove(prod, old.id) : prod;
    setProd(add(base, { track: "music", file, volume: -20, duck: "gentle", fadeOut: 3, start: 0, end: prod.seconds } as Omit<Clip, "id">));
  };
  const rebuild = () => { if (segs.length) { setProd(buildProduction(segs, script, { hasCamera, corner: loadCorner(), brand })); setSel(null); } };

  // Timeline dragging: titles and sound effects move, snapping to sentence edges.
  const points = useMemo(() => snapPoints(segs), [segs]);
  const drag = useRef<{ id: string; x0: number; s0: number; moved: boolean } | null>(null);
  const onClipDown = (e: RPointerEvent, c: Clip) => {
    setSel(c.id);
    if (c.track !== "titles" && c.track !== "sfx") return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: c.id, x0: e.clientX, s0: c.start, moved: false };
  };
  const onClipMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x0) / zoom;
    if (Math.abs(e.clientX - d.x0) > 3) d.moved = true;
    if (d.moved) setProd(q => move(q, d.id, magnet ? snap(d.s0 + dx, points) : d.s0 + dx));
  };
  const onClipUp = () => { drag.current = null; };
  // Playhead: click or drag on the ruler (it follows the pointer, like CapCut).
  const scrubbing = useRef(false);
  const scrubTo = (e: RPointerEvent<HTMLDivElement>) => {
    if (playing) togglePlay();
    const r = e.currentTarget.getBoundingClientRect();
    seek((e.clientX - r.left) / zoom);
  };
  const laneClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    seek((e.clientX - r.left) / zoom);
    setSel(null);
  };

  // Keyboard: Space play, S split, Delete remove (when not typing).
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      else if (e.key === "s" && sel) setProd(q => split(q, sel, t));
      else if ((e.key === "Delete" || e.key === "Backspace") && selected && (selected.track === "titles" || selected.track === "sfx" || selected.track === "music")) { setProd(q => remove(q, selected.id)); setSel(null); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const frameFor = useCallback((step: number) => {
    const fi = view.frameForStep.get(step);
    return view.slides && fi !== undefined && fi >= 0 ? view.slides.frames[fi] : undefined;
  }, [view]);
  const checks = useMemo(() => (prod ? proChecks(prod, script, segs, frameFor) : []), [prod, script, segs, frameFor]);
  const chs = useMemo(() => chapters(segs, script), [segs, script]);

  // The vertical Short: the picked sentences, 9:16, big captions.
  const shortPicks = prod ? prod.short ?? suggestShort(segs, script) : [];
  const pieces = useMemo(() => shortPieces(segs, script, shortPicks, hasCamera), [segs, script, shortPicks.join(","), hasCamera]);
  const shortLen = shortSeconds(pieces);
  const togglePick = (n: number) => setProd(q => {
    const cur = q.short ?? suggestShort(segs, script);
    return { ...q, short: cur.includes(n) ? cur.filter(x => x !== n) : [...cur, n].sort((a, b) => a - b) };
  });
  const doShort = async () => {
    if (!io || !prod) return;
    if (shortLen > SHORT_MAX + 0.5) throw new Error(`The Short is ${shortLen.toFixed(0)} s: untick some sentences to get it under ${SHORT_MAX} s.`);
    const slidePngs = new Map<number, Uint8Array>();
    const slides: (Uint8Array | null)[] = [];
    for (const p of pieces) {
      if (!p.step) { slides.push(null); continue; }
      if (!slidePngs.has(p.step)) slidePngs.set(p.step, await stepPng(script, view, p.step));
      slides.push(slidePngs.get(p.step)!);
    }
    const voice = clipsOn(prod, "voice")[0];
    const ass = shortAss(shortCues(pieces, n => S[n - 1]?.spoken ?? ""), { accent: prod.brand.accent, y: captionYAt(pieces, hasCamera), stressed: stressedWords(script, shortPicks) });
    const r = await io.exportShort(scriptPath, segs, {
      pieces, layout: SHORT_LAYOUT, background: "0x0c0f14", loudness: voice?.loudness ?? -14, clean: voice?.clean ?? true,
      slides, header: await shortHeaderPng(prod.title, prod.brand), ass,
    });
    setShortFile(r.file);
  };

  // Delete the video: exported files to the Recycle Bin, timeline back to the automatic one.
  const deleteVideo = async () => {
    if (!io || !prod) return;
    const files = await io.productionFiles(scriptPath).catch(() => [] as string[]);
    const names = files.map(f => f.split(/[\\/]/).pop()).join(", ");
    if (!window.confirm(`Delete this video?\n\n${files.length ? `These go to the Recycle Bin: ${names}.\n\n` : ""}The timeline starts over (titles, music and your edits are removed). Your recordings and Review choices are kept.`)) return;
    try { if (files.length) await io.deleteProduction(scriptPath); } catch (e) { setError(String((e as Error).message ?? e)); return; }
    setResult(null); setShortFile(null); setSel(null); seek(0);
    setProd(buildProduction(segs, script, { hasCamera, corner: loadCorner(), brand }));
  };

  const doExport = async () => {
    if (!io || !prod) return;
    if (needsRebuild) { setError("Your cut changed in Review: rebuild it (Preview) before exporting."); return; }
    setError(""); setResult(null); setShortFile(null); setProgress(0); busy.current = true;
    store.set("tp.outs", outs);
    try {
      if (outs.short) await doShort();
      if (!outs.mp4 && !outs.srt && !outs.txt && !outs.png) return;
      const slides: Uint8Array[] = [];
      for (const s of clipsOn(prod, "slides")) slides.push(await stepPng(script, view, s.step));
      const titles: Uint8Array[] = [];
      for (const ti of clipsOn(prod, "titles")) titles.push(await titlePng(ti, prod.brand));
      const { mask, ring } = await bubblePngs(360);
      const th = thumb ?? { step: clipsOn(prod, "slides")[0]?.step ?? 0, at: Math.min(2, prod.seconds / 2) };
      let img: HTMLImageElement | null = null;
      const url = slideUrls.current.get(th.step);
      if (url) { img = new Image(); img.src = url; await img.decode().catch(() => { img = null; }); }
      const corner: Corner = clipsOn(prod, "camera").find(c => c.layout === "bubble")?.corner ?? loadCorner();
      const png = await thumbnailPng(img, prod.title, prod.brand, corner);
      setResult(await io.exportProduction(scriptPath, segs, {
        production: prod, slides, titles, mask, ring, srt: toSrt(capList), description: description(prod, segs, script),
        thumbnail: { png, at: th.at, corner }, outputs: outs,
      }));
    } catch (e) { setError(String((e as Error).message ?? e)); }
    finally { busy.current = false; setProgress(null); }
  };

  if (!io) return <section className="screen on" id="production"><div className="panel"><div className="ph"><h2>Production</h2></div><p className="pd-empty">Production works in the desktop app.</p></div></section>;
  if (loaded && reviewReady && !segs.length) return <section className="screen on" id="production"><div className="panel"><div className="ph"><h2>Production</h2></div><p className="pd-empty">Record some sentences first: Production starts from Review’s cut.</p></div></section>;
  if (!prod) return <section className="screen on" id="production"><div className="panel"><div className="ph"><h2>Production</h2></div><p className="pd-empty">{error || "Reading your takes…"}</p></div></section>;

  const total = prod.seconds;
  const width = Math.max(laneW - 20, total * zoom);
  const lib = (
    <div className="panel pd-lib">
      <div className="pd-tabs" role="tablist">
        {(["media", "text", "audio", "brand"] as const).map(x => (
          <button key={x} role="tab" aria-selected={tab === x} onClick={() => setTab(x)}>{x[0].toUpperCase() + x.slice(1)}</button>
        ))}
      </div>
      <div className="pd-libbody">
        {tab === "media" && <>
          <span className="label">This lesson</span>
          <div className="pd-item"><i className="sw k-voice" /><span><b>Final cut</b><small>{fmt(total)} · {segs.length} sentences{needsRebuild ? " · needs a rebuild" : ""}</small></span></div>
          <div className="pd-item"><i className="sw k-slide" /><span><b>Slides</b><small>{clipsOn(prod, "slides").length} steps{view.slides ? ` from ${view.slides.fileName}` : " (ON SCREEN notes)"}</small></span></div>
          <div className="pd-item"><i className="sw k-cam" /><span><b>Camera</b><small>{hasCamera ? "in the cut" : "audio-only takes"}</small></span></div>
          <button className="btn ghost" onClick={rebuild} title="Start again from the cut: your brand kit is kept">Rebuild from the cut</button>
        </>}
        {tab === "text" && <>
          <span className="label">Add at the playhead</span>
          {(Object.keys(TITLE_NAMES) as TitleKind[]).map(k => (
            <button key={k} className="pd-item" onClick={() => addTitle(k)}><i className="sw k-title" /><span><b>{TITLE_NAMES[k]}</b><small>{k === "chapter" ? "chapter name, top centre" : k === "lower" ? "your name and course" : k === "term" ? "word and definition" : k === "outro" ? "end card" : "lesson title"}</small></span></button>
          ))}
        </>}
        {tab === "audio" && <>
          <span className="label">Music</span>
          <button className="pd-item" onClick={() => void pickMusic()}><i className="sw k-music" /><span><b>{music ? "Change music" : "Add music"}</b><small>{music ? music.file.split(/[\\/]/).pop() : "a file you own or have a licence for"}</small></span></button>
          <span className="label">Sound effects (made by the app)</span>
          <button className="pd-item" onClick={() => addSfx("whoosh")}><i className="sw k-sfx" /><span><b>Whoosh</b><small>for a slide change</small></span></button>
          <button className="pd-item" onClick={() => addSfx("pop")}><i className="sw k-sfx" /><span><b>Pop</b><small>for a callout</small></span></button>
        </>}
        {tab === "brand" && <>
          <span className="label">Brand kit · used by every lesson</span>
          <label className="pd-field">Your name<input value={brand.name} onChange={e => setBrand({ ...brand, name: e.target.value })} /></label>
          <label className="pd-field">Course or channel<input value={brand.course} onChange={e => setBrand({ ...brand, course: e.target.value })} /></label>
          <label className="pd-field">Outro text<input value={brand.outro} onChange={e => setBrand({ ...brand, outro: e.target.value })} /></label>
          <label className="pd-field">Accent colour<input type="color" value={brand.accent} onChange={e => setBrand({ ...brand, accent: e.target.value })} /></label>
          <span className="small-note">New titles use these. Lower third and outro text can also be changed per title.</span>
        </>}
      </div>
    </div>
  );

  const slideUrl = now?.slide ? slideUrls.current.get(now.slide.step) : undefined;
  const sinceSlide = now?.slide ? t - now.slide.start : 0;
  const slideStyle = now?.slide ? {
    opacity: now.slide.enter === "fade" ? Math.min(1, sinceSlide / 0.4) : 1,
    transform: now.slide.motion === "zoom" ? `scale(${Math.min(1.08, 1 + 0.0006 * sinceSlide * 30)})` : undefined,
  } : undefined;
  const preview = (
    <div className="panel pd-preview">
      <div className="ph"><h2>Preview</h2><span className="meta">16:9 · 1080p30{music ? " · music ducking is heard in the export" : ""}</span></div>
      <div className="pd-stage">
        <div className="pd-frame">
          {slideUrl && <img className="pd-slide" src={slideUrl} style={slideStyle} alt={`Slide, step ${now?.slide?.step}`} />}
          <video ref={videoRef} className={"pd-cam " + (now?.layout ?? "full") + " " + (now?.corner ?? "br")} src={cut ? mediaUrl(cut.file) : undefined}
            playsInline preload="auto" onEnded={() => setPlaying(false)} />
          <canvas ref={overlayRef} className="pd-over" width={1920} height={1080} aria-hidden="true" />
          {building && <div className="pd-wait">Building the cut… {progress !== null ? Math.round(progress * 100) + "%" : ""}</div>}
          {!building && needsRebuild && cutState !== "checking" && (
            <div className="pd-wait pd-stale">
              <b>{cutState === "missing" ? "The preview needs your cut" : "Your cut changed in Review"}</b>
              <span>{cutState === "missing" ? "Build it from your takes to play the preview." : "Rebuild to see the new reads. Titles, music and your settings are kept."}{cut ? " Until then the preview shows the previous cut." : ""}</span>
              <button className="btn primary" onClick={() => void doRebuild()}>{cutState === "missing" ? "Build the cut" : "Rebuild"}</button>
            </div>)}
        </div>
        {music && <audio ref={musicRef} src={mediaUrl(music.file)} preload="auto" />}
      </div>
      <div className="pd-transport">
        <button className="btn ghost" onClick={() => seek(t - 5)} aria-label="Back 5 seconds">−5 s</button>
        <button className="pd-play" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} disabled={!cut}>{playing ? "❚❚" : "▶"}</button>
        <button className="btn ghost" onClick={() => seek(t + 5)} aria-label="Forward 5 seconds">+5 s</button>
        <span className="mono">{fmtMs(t)} <span className="dim">/ {fmtMs(total)}</span></span>
      </div>
    </div>
  );

  const insp = (
    <div className="panel pd-insp">
      {!selected ? <>
        <div className="ph"><h2>Inspector</h2></div>
        <p className="pd-hint">Click a clip on the timeline to change it. Drag titles and sound effects to move them; they snap to sentence edges. <kbd>Space</kbd> plays, <kbd>S</kbd> splits at the playhead, <kbd>Delete</kbd> removes.</p>
      </> : <>
        <div className="ph"><div><span className="label">{TRACKS.find(x => x.id === selected.track)?.name}</span><h2>{clipLabel(selected)}</h2><span className="pd-time">{fmtMs(selected.start)} – {fmtMs(selected.end)} · {(selected.end - selected.start).toFixed(1)} s</span></div></div>
        <div className="pd-props">
          {selected.track === "titles" && <>
            <label className="pd-field">Type<select value={selected.kind} onChange={e => patch({ kind: e.target.value as TitleKind })}>{(Object.keys(TITLE_NAMES) as TitleKind[]).map(k => <option key={k} value={k}>{TITLE_NAMES[k]}</option>)}</select></label>
            <label className="pd-field">Text<input value={selected.text} onChange={e => patch({ text: e.target.value })} /></label>
            {selected.kind !== "chapter" && <label className="pd-field">{selected.kind === "term" ? "Definition" : "Second line"}<input value={selected.sub} onChange={e => patch({ sub: e.target.value })} /></label>}
            <label className="pd-field">Length (s)<input type="number" min={1} max={30} step={0.5} value={+(selected.end - selected.start).toFixed(1)} onChange={e => patch({ end: Math.min(total, selected.start + Math.max(1, +e.target.value)) })} /></label>
          </>}
          {selected.track === "camera" && <>
            <label className="pd-field">Layout<select value={selected.layout} onChange={e => patch({ layout: e.target.value as "full" })}><option value="full">Full screen</option><option value="bubble">Bubble over slides</option><option value="hidden">Hidden (slides only)</option></select></label>
            {selected.layout === "bubble" && <label className="pd-field">Corner<select value={selected.corner} onChange={e => patch({ corner: e.target.value as Corner })}>{CORNERS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
            <span className="small-note">Split this clip (S) to change the layout for part of the video, e.g. full screen for a key sentence.</span>
          </>}
          {selected.track === "slides" && <>
            <label className="pd-field">Comes in<select value={selected.enter} onChange={e => patch({ enter: e.target.value as "fade" })}><option value="fade">Fade</option><option value="cut">Cut</option></select></label>
            <label className="pd-field">Motion<select value={selected.motion} onChange={e => patch({ motion: e.target.value as "none" })}><option value="none">Still</option><option value="zoom">Slow zoom in</option></select></label>
            <label className="pd-field">Camera bubble here<select value={selected.corner ?? ""} onChange={e => patch({ corner: (e.target.value || undefined) as Corner | undefined })}><option value="">Same as camera</option>{CORNERS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
            <span className="small-note">Slides stay tied to the sentence of their ON SCREEN note. To change when one starts, change the note in Prepare.</span>
          </>}
          {selected.track === "voice" && <>
            <label className="row" htmlFor="vclean">Clean up (hum, hiss, levels)<input id="vclean" type="checkbox" className="switch" checked={selected.clean} onChange={e => patch({ clean: e.target.checked })} /></label>
            <label className="pd-field">Loudness<select value={selected.loudness} onChange={e => patch({ loudness: +e.target.value as -14 })}><option value={-14}>−14 LUFS (YouTube)</option><option value={-16}>−16 LUFS (course sites, podcasts)</option></select></label>
          </>}
          {selected.track === "music" && <>
            <label className="pd-field">Volume<select value={selected.volume} onChange={e => patch({ volume: +e.target.value })}>{[-30, -26, -22, -20, -18, -14].map(v => <option key={v} value={v}>{v} dB</option>)}</select></label>
            <label className="pd-field">Dips under your voice<select value={selected.duck} onChange={e => patch({ duck: e.target.value as "gentle" })}><option value="gentle">Gently</option><option value="strong">Strongly</option><option value="off">No</option></select></label>
            <label className="pd-field">Fade out (s)<input type="number" min={0} max={15} value={selected.fadeOut} onChange={e => patch({ fadeOut: +e.target.value })} /></label>
            <span className="small-note">Use only music you own or have a licence for.</span>
          </>}
          {selected.track === "sfx" && <>
            <label className="pd-field">Sound<select value={selected.sound} onChange={e => patch({ sound: e.target.value as "pop" })}><option value="whoosh">Whoosh</option><option value="pop">Pop</option></select></label>
            <label className="pd-field">Level<select value={selected.volume} onChange={e => patch({ volume: +e.target.value })}>{[-26, -22, -18, -14].map(v => <option key={v} value={v}>{v} dB</option>)}</select></label>
          </>}
          {selected.track === "captions" && <>
            <label className="pd-field">Style<select value={selected.style} onChange={e => patch({ style: e.target.value as "clean" })}><option value="clean">Clean box</option><option value="bold">Bold outline</option><option value="off">Off (still exported as .srt)</option></select></label>
            <span className="small-note">Text comes from your script, so names and terms are spelled right.</span>
          </>}
          <div className="pd-actions">
            <button className="btn ghost" onClick={() => setProd(q => split(q, selected.id, t))} disabled={t <= selected.start || t >= selected.end}>Split at playhead</button>
            {(selected.track === "titles" || selected.track === "sfx" || selected.track === "music") && <button className="btn ghost" onClick={() => { setProd(q => remove(q, selected.id)); setSel(null); }}>Delete</button>}
          </div>
        </div>
      </>}
    </div>
  );

  const tl = (
    <div className="panel pd-tl">
      <div className="pd-tools">
        <button className="btn ghost" onClick={() => sel && setProd(q => split(q, sel, t))} disabled={!sel}>Split <kbd>S</kbd></button>
        <button className={"btn ghost" + (magnet ? " on" : "")} aria-pressed={magnet} onClick={() => setMagnet(!magnet)}>Snap to sentences</button>
        <span className="pd-spacer" />
        <label className="pd-zoom">Zoom<input type="range" min={1} max={60} step={0.5} value={zoom} onChange={e => { setZoom(+e.target.value); store.set("tp.zoom", +e.target.value); }} /></label>
        <button className={"btn ghost" + (!zoomSet ? " on" : "")} aria-pressed={!zoomSet} onClick={() => { setZoom(0); store.set("tp.zoom", 0); }}>Fit</button>
        <button className="btn ghost danger" onClick={() => void deleteVideo()} title="Send the exported files to the Recycle Bin and start the timeline over">Delete video…</button>
        <button className="btn primary" onClick={() => setPane("export")}>Polish &amp; export →</button>
      </div>
      <div className="pd-scroll">
        <div className="pd-heads">
          <div className="pd-rulerhead">Chapters</div>
          {TRACKS.map(tr => <div key={tr.id} className="pd-head"><span className="tag">{tr.tag}</span>{tr.name}</div>)}
        </div>
        <div className="pd-lanes" ref={lanesRef}>
          <div className="pd-inner" style={{ width }}>
            <div className="pd-ruler" title="Click or drag to move the playhead"
              onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); scrubbing.current = true; scrubTo(e); }}
              onPointerMove={e => { if (scrubbing.current) scrubTo(e); }}
              onPointerUp={() => { scrubbing.current = false; }}>
              <span className="pd-head-grip" style={{ left: t * zoom }} aria-hidden="true" />
              {Array.from({ length: Math.floor(total / (zoom < 6 ? 60 : zoom < 20 ? 15 : 5)) + 1 }, (_, i) => i * (zoom < 6 ? 60 : zoom < 20 ? 15 : 5)).map(s => <span key={s} className="tick" style={{ left: s * zoom }}>{fmt(s)}</span>)}
              {chs.map(c => <span key={c.start} className="chap" style={{ left: c.start * zoom }}>◆ {c.name}</span>)}
            </div>
            {TRACKS.map(tr => (
              <div key={tr.id} className="pd-lane" onClick={laneClick}>
                {clipsOn(prod, tr.id).map(c => (
                  <button key={c.id} className={"pd-clip " + CLIP_COLOURS[tr.id] + (sel === c.id ? " sel" : "") + (c.track === "titles" || c.track === "sfx" ? " movable" : "")}
                    style={{ left: c.start * zoom, width: Math.max(4, (c.end - c.start) * zoom) }} title={clipLabel(c)}
                    onPointerDown={e => onClipDown(e, c)} onPointerMove={onClipMove} onPointerUp={onClipUp}>{clipLabel(c)}</button>
                ))}
              </div>
            ))}
            <div className="pd-head-line" style={{ left: t * zoom }} aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );

  const exportPane = (
    <div className="pd-export">
      <div className="panel">
        <div className="ph"><button className="btn ghost" onClick={() => setPane("edit")}>← Timeline</button><h2>Pro checks</h2><span className="meta">{checks.filter(c => c.ok).length} of {checks.length} pass</span></div>
        <div className="pd-checks">
          {checks.map(c => (
            <div key={c.id} className={"pd-check" + (c.ok ? " ok" : " bad")}>
              <span className="dot" aria-hidden="true">{c.ok ? "✓" : "!"}</span>
              <span><b>{c.name}</b><small>{c.detail}</small></span>
              {c.fix && <button className="btn" onClick={() => setProd(q => c.fix!.apply(q))}>{c.fix.label}</button>}
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="ph"><h2>Export</h2><span className="meta">1920×1080 · 30 fps · H.264 + AAC</span></div>
        <div className="pd-props">
          <span className="label">Files</span>
          {([["mp4", "MP4", "The finished video"], ["srt", "SRT", "Captions file for YouTube’s subtitle track"], ["txt", "TXT", "Description with chapter timestamps"], ["png", "PNG", "Thumbnail, 1280×720"]] as const).map(([k, ext, name]) => (
            <label key={k} className="pd-out"><input type="checkbox" checked={outs[k]} onChange={e => setOuts({ ...outs, [k]: e.target.checked })} /><span className="ext">{ext}</span>{name}</label>
          ))}
          <label className="pd-out"><input type="checkbox" checked={!!outs.short} onChange={e => setOuts({ ...outs, short: e.target.checked })} /><span className="ext">MP4</span>Vertical Short, 9:16, up to {SHORT_MAX} s</label>
          {outs.short && <>
            <span className="label">Short: {shortLen.toFixed(0)} s of {SHORT_MAX} s{shortLen > SHORT_MAX ? " · too long" : ""}</span>
            <div className="pd-short">
              {segs.map(sg => (
                <label key={sg.sentence} className={shortPicks.includes(sg.sentence) ? "on" : ""}>
                  <input type="checkbox" checked={shortPicks.includes(sg.sentence)} onChange={() => togglePick(sg.sentence)} />
                  <span>{S[sg.sentence - 1]?.spoken ?? sg.text}</span><small>{(sg.end - sg.start).toFixed(1)} s</small>
                </label>
              ))}
            </div>
            <span className="small-note">Suggested: your opening line as the hook, then the passage that packs the most in. Slide on top, you below, big captions in your accent colour.
              {prod.short && <> <button className="linkbtn" onClick={() => setProd(q => ({ ...q, short: undefined }))}>Back to the suggestion</button></>}</span>
          </>}
          <span className="label">Thumbnail</span>
          <div className="pd-thumbs">
            {clipsOn(prod, "slides").slice(0, 4).map(s => (
              <button key={s.id} className={"pd-thumb" + ((thumb?.step ?? clipsOn(prod, "slides")[0]?.step) === s.step ? " on" : "")} onClick={() => setThumb({ step: s.step, at: s.start + 1 })}>
                {slideUrls.current.get(s.step) && <img src={slideUrls.current.get(s.step)} alt="" />}<b>{prod.title}</b>
              </button>
            ))}
          </div>
          <span className="small-note">Your face comes from the camera at that slide; the title is the lesson title.</span>
          <span className="label">YouTube description</span>
          <pre className="pd-desc">{description(prod, segs, script)}</pre>
          <button className="btn primary pd-go" onClick={() => void doExport()} disabled={progress !== null || building || needsRebuild}>
            {progress !== null ? `Exporting… ${Math.round(progress * 100)}%` : `Export ${Object.values(outs).filter(Boolean).length} file${Object.values(outs).filter(Boolean).length === 1 ? "" : "s"}`}
          </button>
          {progress !== null && <div className="vsetup"><div className="bar"><b style={{ width: `${Math.round(progress * 100)}%` }} /></div></div>}
          {shortFile && <div className="out"><span className="ext">9:16</span><span className="f" title={shortFile}>{shortFile.split(/[\\/]/).pop()}</span><button className="linkbtn" onClick={() => void io?.reveal(shortFile)}>Show file</button></div>}
          {result && ([["MP4", result.file], ["SRT", result.srt], ["TXT", result.txt], ["PNG", result.png]] as const).filter(([, f]) => f).map(([ext, f]) => (
            <div key={ext} className="out"><span className="ext">{ext}</span><span className="f" title={f!}>{f!.split(/[\\/]/).pop()}</span><button className="linkbtn" onClick={() => void io?.reveal(f!)}>Show file</button></div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <section className="screen on" id="production">
      {pane === "edit" ? <>
        <div className="pd-work">{lib}{preview}{insp}</div>
        {tl}
      </> : exportPane}
      {error && <div className="vsetup err">{error}</div>}
    </section>
  );
}
