import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { Script } from "../lib/script";
import type { SlideView } from "./ScreenCard";
import { takes as io, mediaUrl, type ProductionOptions, type ProductionResult } from "../lib/bridge";
import { buildEdit, timeline, type Segment, type TakeInfo } from "../lib/edit";
import { useReview } from "../lib/reviewState";
import { exportJob, useExportJob } from "../lib/exportJob";
import { refit } from "../lib/production";
import { cues, toSrt } from "../lib/captions";
import { loadCorner, CORNERS, type Corner } from "../lib/bubble";
import { bubblePngs, drawFrame, drawInFrames, stepPng, W as SW, H as SH } from "../lib/slideImage";
import { busyAt, plan as drawPlan, timedWords, type DrawMode, type Planned } from "../lib/drawOn";
import type { Frame } from "../lib/excalidraw";
import { drawCaption, drawTitle, shortHeaderPng, thumbnailPng, titlePng } from "../lib/titleArt";
import { SHORT_LAYOUT, SHORT_MAX, captionYAt, shortAss, shortCues, shortPieces, shortSeconds, stressedWords, suggestShort } from "../lib/short";
import {
  TRACKS, DEFAULT_BRAND, add, applyTracks, scriptKey, cutAt, gapSpans, insertGap, removeGap, setGapDur, tlOf, at, canTurnOff, deletable, duplicate, isLocked, isOff, setTrack, toggleMarker, trim, trimmable, buildProduction, chapters, clipsOn, cutKey, description, move, proChecks, remove, snap, snapPoints, split, update,
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
  const [cut, setCut] = useState<{ file: string; seconds: number; version?: number } | null>(null);
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
  // The export lives outside this screen (it keeps running when you switch tabs).
  const job = useExportJob();
  const mine = job && job.kind === "production" && job.scriptPath === scriptPath ? job : null;
  const result = mine?.result ?? null;
  const exporting = !!mine?.running;
  const [outs, setOuts] = useState(() => store.get("tp.outs", { mp4: true, srt: true, txt: true, png: true, short: false }));
  const shortFile = mine?.short ?? null;
  const [thumb, setThumb] = useState<{ step: number; at: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const zoom = zoomSet || Math.max(0.5, (laneW - 20) / Math.max(1, prod?.seconds ?? 60));
  const musicRef = useRef<HTMLAudioElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const slideUrls = useRef(new Map<number, string>());
  const [, bump] = useState(0);

  // Undo / redo: every change keeps the timeline as it was (a drag counts once).
  const prodRef = useRef<Prod | null>(null);
  prodRef.current = prod;
  const hist = useRef<{ past: Prod[]; future: Prod[] }>({ past: [], future: [] });
  const snapshot = useCallback(() => {
    const cur = prodRef.current;
    if (!cur) return;
    const h = hist.current;
    if (h.past.at(-1) !== cur) { h.past.push(cur); if (h.past.length > 200) h.past.shift(); }
    h.future = [];
  }, []);
  const setProd = useCallback((p: Prod | ((q: Prod) => Prod), record = true) => {
    if (record) snapshot();
    setProdRaw(q => { const next = typeof p === "function" ? (q ? p(q) : q) : p; if (next) store.set("tp.prod:" + scriptPath, next); return next; });
  }, [scriptPath, snapshot]);
  const travel = (from: "past" | "future") => {
    const h = hist.current, cur = prodRef.current;
    const to = h[from].pop();
    if (!to || !cur) return;
    h[from === "past" ? "future" : "past"].push(cur);
    store.set("tp.prod:" + scriptPath, to);
    setProdRaw(to);
  };
  const undo = () => travel("past");
  const redo = () => travel("future");
  // The brand is written into the titles that use it (lower third, title card, outro); a text you typed yourself is kept.
  const setBrand = (b: Brand) => {
    const old = brand;
    setBrandRaw(b); store.set("tp.brand", b);
    const swap = (x: string, from: string, to: string) => (from !== to && x === from ? to : x);
    setProd(p => ({
      ...p, brand: b,
      clips: p.clips.map(c => {
        if (c.track !== "titles") return c;
        if (c.kind === "lower") return { ...c, text: swap(c.text, old.name, b.name), sub: swap(c.sub, old.course, b.course) };
        if (c.kind === "title") return { ...c, sub: swap(c.sub, old.course, b.course) };
        if (c.kind === "outro") return { ...c, text: swap(c.text, old.outro, b.outro) };
        return c;
      }),
    }));
  };

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
    // Titles still showing the placeholder brand ("Your name", "Your course") get yours.
    const fill = (p: Prod): Prod => ({
      ...p, brand,
      clips: p.clips.map(c => c.track !== "titles" ? c : {
        ...c,
        text: c.text === DEFAULT_BRAND.name ? brand.name : c.text === DEFAULT_BRAND.outro ? brand.outro : c.text,
        sub: c.sub === DEFAULT_BRAND.course ? brand.course : c.sub,
      }),
    });
    setProdRaw(fill(saved ?? buildProduction(segs, script, { hasCamera, corner: loadCorner(), brand })));
    hist.current = { past: [], future: [] };
    if (!io) return;
    setCutState("checking");
    io.cutStatus(scriptPath, segs).then(st => {
      setCut(st ? { file: st.file, seconds: st.seconds, version: st.version } : null);
      setCutState(!st ? "missing" : st.fresh ? "fresh" : "stale");
    }).catch(() => setCutState("missing"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, key, scriptPath]);
  const busy = useRef(false);
  useEffect(() => io?.onExportProgress(x => { if (busy.current) setProgress(x); }), []);
  const sKey = useMemo(() => scriptKey(script), [script]);
  const scriptChanged = !!prod?.scriptKey && prod.scriptKey !== sKey;
  const needsRebuild = !!prod && (prod.cutKey !== key || scriptChanged || cutState === "stale" || cutState === "missing");
  const doRebuild = async () => {
    if (!io || !prod || busy.current || exportJob.get()?.running) return;
    busy.current = true; setBuilding(true); setProgress(0); setError("");
    try {
      const c = await io.productionCut(scriptPath, segs);
      setCut(c); setCutState("fresh");
      if (prod.cutKey !== key || scriptChanged) setProd(q => refit(q, buildProduction(segs, script, { hasCamera, corner: loadCorner(), brand: q.brand })));
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

  // Playback clock: the cut video drives the time; during a pause the picture holds and a clock runs on.
  const pauseRef = useRef<{ start: number; end: number; clock: number } | null>(null);
  const lastC = useRef(0);
  const prodNow = useRef<Prod | null>(null);
  prodNow.current = prod;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current, p = prodNow.current;
      if (v && p) {
        const g = pauseRef.current;
        if (g) {
          const x = g.start + (performance.now() - g.clock) / 1000;
          if (x >= p.seconds) { setT(p.seconds); pauseRef.current = null; musicRef.current?.pause(); setPlaying(false); return; }
          if (x >= g.end) { pauseRef.current = null; void v.play(); }
          setT(Math.min(x, g.end));
        } else {
          const c = v.currentTime;
          // Reaching a pause (or the end of the cut with room after it): hold the frame.
          const span = gapSpans(p).find(x => x.cut > lastC.current && (c >= x.cut - 0.02 || v.ended));
          lastC.current = c;
          if (span) {
            v.pause(); v.currentTime = span.cut; lastC.current = span.cut;
            pauseRef.current = { start: span.start, end: span.end, clock: performance.now() };
            setT(span.start);
          } else if (v.ended || tlOf(p, c) >= p.seconds) { setT(p.seconds); musicRef.current?.pause(); setPlaying(false); return; }
          else setT(tlOf(p, c));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  const seek = (x: number) => {
    const s = Math.max(0, Math.min(prod?.seconds ?? 0, x));
    setT(s);
    const at = prod ? cutAt(prod, s) : { c: s };
    pauseRef.current = null;
    lastC.current = at.gap ? at.c : at.c - 1e-4;
    if (videoRef.current) videoRef.current.currentTime = at.c;
    if (playing && videoRef.current) {
      if (at.gap) { videoRef.current.pause(); pauseRef.current = { start: s, end: at.gap.end, clock: performance.now() }; }
      else void videoRef.current.play();
    }
    if (musicRef.current) musicRef.current.currentTime = s;
  };
  const togglePlay = () => {
    const v = videoRef.current, m = musicRef.current;
    if (!v || !prod) return;
    if (playing) { v.pause(); m?.pause(); pauseRef.current = null; setPlaying(false); return; }
    const from = t >= prod.seconds - 0.05 ? 0 : t;
    const at = cutAt(prod, from);
    v.currentTime = at.c;
    lastC.current = at.gap ? at.c : at.c - 1e-4;
    if (at.gap) pauseRef.current = { start: from, end: at.gap.end, clock: performance.now() };
    else { pauseRef.current = null; void v.play(); }
    if (m) { m.currentTime = from; void m.play(); }
    setT(from); setPlaying(true);
  };

  // Captions on the timeline's clock (after pauses they come later).
  const gapsNow = prod?.gaps;
  const capList = useMemo(() => {
    const g = { gaps: gapsNow } as Prod;
    return cues(segs, n => S[n - 1]?.spoken ?? "").map(q => ({ ...q, start: tlOf(g, q.start), end: tlOf(g, q.end, true) }));
  }, [segs, S, gapsNow]);
  // What plays: hidden or muted lanes left out.
  const live = useMemo(() => (prod ? applyTracks(prod) : null), [prod]);
  const now = live ? at(live, t) : null;

  // Titles and captions over the picture, drawn the way they will be exported.
  useEffect(() => {
    const c = overlayRef.current;
    if (!c || !live) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const ti of at(live, t).titles) drawTitle(ctx, ti, live.brand, Math.min(1, (t - ti.start) / 0.35, (ti.end - t) / 0.35));
    const cap = clipsOn(live, "captions")[0];
    const cue = capList.find(q => t >= q.start && t < q.end);
    if (cap && cap.style !== "off" && cue) drawCaption(ctx, cue, cap.style);
  }, [t, live, capList]);

  // Music volume in the preview (ducking is only heard in the export).
  const music = live ? clipsOn(live, "music")[0] : undefined;
  useEffect(() => { if (musicRef.current && music) musicRef.current.volume = Math.min(1, Math.pow(10, music.volume / 20)); }, [music]);

  const selected = prod?.clips.find(c => c.id === sel) ?? null;
  const selLocked = !!(prod && selected && isLocked(prod, selected.track));
  const patch = (p: Partial<Clip>) => sel && !selLocked && setProd(q => update(q, sel, p));
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
  // Start the timeline over from the cut (building the cut first when it is missing or out of date).
  const [rebuilt, setRebuilt] = useState("");
  useEffect(() => { if (!rebuilt) return; const id = setTimeout(() => setRebuilt(""), 6000); return () => clearTimeout(id); }, [rebuilt]);
  const rebuild = async () => {
    if (!segs.length || busy.current || exportJob.get()?.running) return;
    if (!window.confirm("Start the timeline over from your cut?\n\nTitles, music and your edits are removed; your brand kit is kept.")) return;
    setRebuilt(""); setError("");
    if (io && (cutState === "stale" || cutState === "missing")) {
      busy.current = true; setBuilding(true); setProgress(0);
      try { const c = await io.productionCut(scriptPath, segs); setCut(c); setCutState("fresh"); }
      catch (e) { setError(String((e as Error).message ?? e)); return; }
      finally { busy.current = false; setBuilding(false); setProgress(null); }
    }
    setProd(buildProduction(segs, script, { hasCamera, corner: loadCorner(), brand }));
    setSel(null); seek(0);
    setRebuilt(`Done: timeline rebuilt from your cut (${segs.length} sentences, ${fmt(segs.reduce((a, x) => a + x.end - x.start, 0))}).`);
  };

  // Timeline dragging: titles and sound effects move, snapping to sentence edges.
  const points = useMemo(() => {
    const g = { gaps: gapsNow } as Prod;
    return [...snapPoints(segs).map(x => tlOf(g, x)), ...snapPoints(segs).map(x => tlOf(g, x, true))];
  }, [segs, gapsNow]);
  // Every clip but voice and captions can be trimmed by its edges; titles, sound effects and music also move.
  const drag = useRef<{ id: string; x0: number; s0: number; moved: boolean; mode: "move" | "start" | "end" } | null>(null);
  const onClipDown = (e: RPointerEvent, c: Clip) => {
    setSel(c.id); setSelGap(null);
    if (prod && isLocked(prod, c.track)) return;
    if (c.track !== "titles" && c.track !== "sfx" && c.track !== "music") return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: c.id, x0: e.clientX, s0: c.start, moved: false, mode: "move" };
  };
  const onEdgeDown = (e: RPointerEvent, c: Clip, edge: "start" | "end") => {
    e.stopPropagation();
    setSel(c.id);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: c.id, x0: e.clientX, s0: edge === "start" ? c.start : c.end, moved: false, mode: edge };
  };
  const onClipMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x0) / zoom;
    if (!d.moved && Math.abs(e.clientX - d.x0) > 3) { d.moved = true; snapshot(); }
    if (!d.moved) return;
    const to = magnet ? snap(d.s0 + dx, points) : d.s0 + dx;
    if (d.mode === "move") setProd(q => move(q, d.id, to), false);
    else { const mode = d.mode; setProd(q => trim(q, d.id, mode, to), false); }
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
    setSel(null); setSelGap(null);
  };

  // Editing actions (toolbar and keyboard), CapCut style.
  const canEdit = !!selected && !selLocked;
  const doSplit = () => { if (canEdit && selected && t > selected.start + 0.2 && t < selected.end - 0.2) setProd(q => split(q, selected.id, t)); };
  const trimLeft = () => { if (canEdit && selected && trimmable(selected)) setProd(q => trim(q, selected.id, "start", t)); };
  const trimRight = () => { if (canEdit && selected && trimmable(selected)) setProd(q => trim(q, selected.id, "end", t)); };
  // Delete: titles, slides, music and sounds go; a camera piece hides the camera there (slides only);
  // the voice and captions follow your cut, so they say where to change that instead.
  const [hint, setHint] = useState("");
  useEffect(() => { if (!hint) return; const id = setTimeout(() => setHint(""), 7000); return () => clearTimeout(id); }, [hint]);
  const doDelete = () => {
    if (selGap !== null) { setProd(q => removeGap(q, selGap)); setSelGap(null); return; }
    if (!selected) return;
    if (selLocked) { setHint("This lane is locked: unlock it (🔒) to delete."); return; }
    if (selected.track === "camera") {
      setProd(q => update(q, selected.id, { layout: "hidden" }));
      setHint("Camera removed from this part: the slide shows on its own. To bring it back, pick a layout in the Inspector.");
      return;
    }
    if (selected.track === "voice" || selected.track === "captions") {
      setHint("Your voice and captions follow the cut. To cut out what you say, remove that read in Review (×) or record the sentence again.");
      return;
    }
    if (deletable(selected)) { setProd(q => remove(q, selected.id)); setSel(null); }
  };
  const doDuplicate = () => {
    if (!canEdit || !selected || !prod) return;
    const next = duplicate(prod, selected.id);
    if (next !== prod) { setProd(next); setSel(next.clips.at(-1)!.id); }
  };
  const marker = () => setProd(q => toggleMarker(q, t));
  // Pauses: added at the playhead (at the end: room after your last word).
  const [selGap, setSelGap] = useState<number | null>(null);
  const addPause = (d = 1) => {
    if (!prod) return;
    if (t < 0.05) { setHint("Move the playhead a little after the start to add a pause."); return; }
    setProd(q => insertGap(q, t, d));
    setHint(t >= prod.seconds - 0.05 ? `Added ${d} s at the end: you can now move titles (like the outro) there.` : `Added a ${d} s pause: the picture holds and everything after moves right. Click it on the Voice lane to change its length.`);
  };
  const zoomBy = (k: number) => { const z = Math.max(1, Math.min(60, +(zoom * k).toFixed(2))); setZoom(z); store.set("tp.zoom", z); };
  /** Jump to the previous or next sentence edge, clip edge or marker. */
  const jump = (dir: -1 | 1) => {
    if (!prod) return;
    const edges = [...points, ...prod.clips.flatMap(c => [c.start, c.end]), ...(prod.markers ?? [])].sort((a, b) => a - b);
    const to = dir > 0 ? edges.find(x => x > t + 0.01) : [...edges].reverse().find(x => x < t - 0.01);
    if (to !== undefined) seek(to);
  };

  // Keyboard: Space play, S / Ctrl+B split, Q / W trim to the playhead, Delete, Ctrl+D duplicate, M marker,
  // Ctrl+Z / Ctrl+Shift+Z undo / redo, arrows step a frame (Shift: a second), Up / Down jump between edges, + / - zoom.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
      if (mod && key === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && key === "y") { e.preventDefault(); redo(); }
      else if (mod && key === "b") { e.preventDefault(); doSplit(); }
      else if (mod && key === "d") { e.preventDefault(); doDuplicate(); }
      else if (mod) return;
      else if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      else if (key === "s") doSplit();
      else if (key === "q") trimLeft();
      else if (key === "w") trimRight();
      else if (key === "m") marker();
      else if (key === "p") addPause(1);
      else if (e.key === "Delete" || e.key === "Backspace") doDelete();
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); seek(t + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 1 / 30)); }
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); jump(e.key === "ArrowUp" ? -1 : 1); }
      else if (e.key === "Home") seek(0);
      else if (e.key === "End") seek(prod?.seconds ?? 0);
      else if (e.key === "+" || e.key === "=") zoomBy(1.25);
      else if (e.key === "-") zoomBy(0.8);
      else if (e.key === "Escape") setSel(null);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const frameFor = useCallback((step: number) => {
    const fi = view.frameForStep.get(step);
    return view.slides && fi !== undefined && fi >= 0 ? view.slides.frames[fi] : undefined;
  }, [view]);
  const checks = useMemo(() => (prod ? proChecks(prod, script, segs, frameFor) : []), [prod, script, segs, frameFor]);

  // Drawing plans: each run of slide clips showing the same Excalidraw frame draws in once,
  // its parts timed to when you name them (see drawOn.ts).
  const delay = prod?.drawDelay ?? 0.3;
  const words = useMemo(() => timedWords(segs, n => (S[n - 1]?.tokens ?? []).map(k => (k.type === "word" ? { type: "word" as const, text: k.text } : k.type === "pause" ? { type: "pause" as const, secs: k.secs } : { type: "breath" as const })))
    .map(w => ({ ...w, t: tlOf({ gaps: gapsNow } as Prod, w.t) + delay })), [segs, S, delay, gapsNow]);
  const plans = useMemo(() => {
    const out = new Map<string, { frame: Frame; plan: Planned[] }>();
    if (!prod) return out;
    const list = clipsOn(prod, "slides");
    for (let i = 0; i < list.length;) {
      const frame = frameFor(list[i].step);
      let j = i + 1;
      while (j < list.length && frame && frameFor(list[j].step) === frame && Math.abs(list[j].start - list[j - 1].end) < 0.05) j++;
      const mode: DrawMode = list[i].draw ?? "said";
      if (frame && mode !== "still") {
        const plan = drawPlan(frame, mode, list[i].start, list[j - 1].end, words);
        for (let k = i; k < j; k++) out.set(list[k].id, { frame, plan });
      }
      i = j;
    }
    return out;
  }, [prod, frameFor, words]);
  const drawRef = useRef<HTMLCanvasElement>(null);
  const drawnAt = useRef<{ id: string; t: number } | null>(null);
  const curSlide = prod ? at(prod, t).slide : undefined;
  const curDraw = curSlide ? plans.get(curSlide.id) : undefined;
  useEffect(() => {
    const c = drawRef.current;
    if (!c || !curDraw || !curSlide) return;
    // Redraw only while something is drawing in, or when jumping.
    const last = drawnAt.current;
    if (last && last.id === curSlide.id && Math.abs(last.t - t) < 2 && !busyAt(curDraw.plan, t) && !busyAt(curDraw.plan, last.t)
      && curDraw.plan.every(p => (p.start + p.dur <= t) === (p.start + p.dur <= last.t) && (p.start <= t) === (p.start <= last.t))) return;
    drawFrame(c.getContext("2d")!, curDraw.frame, SW, SH, { plan: curDraw.plan, t });
    drawnAt.current = { id: curSlide.id, t };
  });
  const chs = useMemo(() => chapters(segs, script).map(c => ({ ...c, start: tlOf({ gaps: gapsNow } as Prod, c.start) })), [segs, script, gapsNow]);

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
    exportJob.set({ short: r.file });
  };

  // Delete the video: exported files to the Recycle Bin, timeline back to the automatic one.
  const deleteVideo = async () => {
    if (!io || !prod) return;
    const files = await io.productionFiles(scriptPath).catch(() => [] as string[]);
    const names = files.map(f => f.split(/[\\/]/).pop()).join(", ");
    if (!window.confirm(`Delete this video?\n\n${files.length ? `These go to the Recycle Bin: ${names}.\n\n` : ""}The timeline starts over (titles, music and your edits are removed) and the cut is made again from your takes when you click Build. Your recordings and Review choices are kept.`)) return;
    try { if (files.length) await io.deleteProduction(scriptPath); } catch (e) { setError(String((e as Error).message ?? e)); return; }
    exportJob.clear(); setSel(null); seek(0);
    // The cut went too: the preview waits for "Build the cut".
    if (files.length) { setCut(null); setCutState("missing"); }
    setProd(buildProduction(segs, script, { hasCamera, corner: loadCorner(), brand }));
    setRebuilt(`Done: video deleted${files.length ? ` (${files.length} file${files.length === 1 ? "" : "s"} in the Recycle Bin)` : ""}, timeline started over. Click "Build the cut" in the preview to make it again from your takes.`);
  };

  const doExport = async () => {
    if (!io || !prod || exportJob.get()?.running) return;
    if (needsRebuild) { setError("Your cut changed in Review: rebuild it (Preview) before exporting."); return; }
    setError(""); exportJob.start(scriptPath);
    store.set("tp.outs", outs);
    try {
      const prod = live!; // hidden or muted lanes left out
      // The thumbnail's slide first: the preview's pictures go away if you leave this screen.
      const th = thumb ?? { step: clipsOn(prod, "slides")[0]?.step ?? 0, at: Math.min(2, prod.seconds / 2) };
      let img: HTMLImageElement | null = null;
      const url = slideUrls.current.get(th.step);
      if (url) { img = new Image(); img.src = url; await img.decode().catch(() => { img = null; }); }
      const corner: Corner = clipsOn(prod, "camera").find(c => c.layout === "bubble")?.corner ?? loadCorner();
      const png = await thumbnailPng(img, prod.title, prod.brand, corner);
      if (outs.short) { exportJob.set({ stage: "Making the Short" }); await doShort(); }
      if (!outs.mp4 && !outs.srt && !outs.txt && !outs.png) { exportJob.set({ running: false, progress: 1, stage: "Done" }); return; }
      exportJob.set({ stage: "Preparing slides", progress: 0 });
      const slides: ProductionOptions["slides"] = [];
      const list = clipsOn(prod, "slides");
      for (const [i, s] of list.entries()) {
        const d = plans.get(s.id);
        slides.push(d ? await drawInFrames(d.frame, d.plan, s.start, s.end) : await stepPng(script, view, s.step));
        exportJob.set({ stage: `Preparing slides (${i + 1} of ${list.length})` });
      }
      const titles: Uint8Array[] = [];
      for (const ti of clipsOn(prod, "titles")) titles.push(await titlePng(ti, prod.brand));
      const { mask, ring } = await bubblePngs(360);
      exportJob.set({ stage: "Exporting", progress: 0 });
      const res = await io.exportProduction(scriptPath, segs, {
        production: prod, slides, titles, mask, ring, srt: toSrt(capList), description: description(prod, segs, script),
        thumbnail: { png, at: cutAt(prod, th.at).c, corner }, outputs: outs,
      });
      exportJob.set({ running: false, progress: 1, stage: "Done", result: res });
    } catch (e) { exportJob.set({ running: false, stage: "Failed", error: String((e as Error).message ?? e) }); }
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
          <button className="btn ghost" onClick={() => void rebuild()} disabled={building} title="Start again from the cut: your brand kit is kept">
            {building ? `Building the cut… ${progress !== null ? Math.round(progress * 100) + "%" : ""}` : "Rebuild from the cut"}
          </button>
          {building && <div className="vsetup"><div className="bar"><b style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} /></div></div>}
          {rebuilt && <p className="pd-done" role="status">{rebuilt}</p>}
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
  const drawing = now?.slide ? plans.get(now.slide.id) : undefined;
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
          {slideUrl && !drawing && <img className="pd-slide" src={slideUrl} style={slideStyle} alt={`Slide, step ${now?.slide?.step}`} />}
          {drawing && <canvas ref={drawRef} className="pd-slide" width={SW} height={SH} style={slideStyle} aria-label={`Slide, step ${now?.slide?.step}, drawing in`} />}
          <video ref={videoRef} className={"pd-cam " + (now?.layout ?? "full") + " " + (now?.corner ?? "br")} src={cut ? mediaUrl(cut.file) + (cut.version ? `?v=${Math.round(cut.version)}` : "") : undefined}
            playsInline preload="auto" onEnded={() => { if (!pauseRef.current && !(prod?.gaps ?? []).length) setPlaying(false); }} />
          <canvas ref={overlayRef} className="pd-over" width={1920} height={1080} aria-hidden="true" />
          {building && <div className="pd-wait pd-building">Building the cut… {progress !== null ? Math.round(progress * 100) + "%" : ""}</div>}
          {!building && needsRebuild && cutState !== "checking" && (
            <div className="pd-wait pd-stale">
              <b>{cutState === "missing" ? "The preview needs your cut" : scriptChanged && prod.cutKey === key && cutState === "fresh" ? "Your script changed on disk" : "Your cut changed in Review"}</b>
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
      {selGap !== null && prod.gaps?.[selGap] ? <>
        <div className="ph"><span className="label">Pause</span><h2>{prod.gaps[selGap].cut >= prod.seconds - prod.gaps.reduce((a, g) => a + g.dur, 0) - 0.05 ? "Room after the last word" : "Pause in the video"}</h2></div>
        <div className="pd-props">
          <label className="pd-field">Length (seconds)<input type="number" min={0.1} max={30} step={0.1} value={prod.gaps[selGap].dur}
            onChange={e => { const d = Math.max(0.1, Math.min(30, +e.target.value || 0.1)); setProd(q => setGapDur(q, selGap, d)); }} /></label>
          <span className="small-note">The picture holds its frame and the sound is silent (music keeps playing). Titles, slides and sounds after it move with it.</span>
          <button className="btn ghost" onClick={doDelete}>Remove pause</button>
        </div>
      </> : !selected ? <>
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
            {frameFor(selected.step) && <label className="pd-field">Drawing<select value={selected.draw ?? "said"} onChange={e => patch({ draw: e.target.value as DrawMode })}>
              <option value="said">Draws in as you name each part</option><option value="quick">Draws in quickly, part by part</option><option value="still">Shows whole (no drawing)</option></select></label>}
            {frameFor(selected.step) && (selected.draw ?? "said") === "said" && <label className="pd-field">Drawing timing (all slides)<select value={String(prod?.drawDelay ?? 0.3)} onChange={e => setProd(q => ({ ...q, drawDelay: +e.target.value }))}>
              <option value="-0.3">Just before you say it</option><option value="0">As you start the word</option><option value="0.3">Just after (default)</option><option value="0.7">A beat later</option><option value="1.2">Clearly after</option></select></label>}
            <label className="pd-field">Comes in<select value={selected.enter} onChange={e => patch({ enter: e.target.value as "fade" })}><option value="fade">Fade</option><option value="cut">Cut</option></select></label>
            <label className="pd-field">Motion<select value={selected.motion} onChange={e => patch({ motion: e.target.value as "none" })}><option value="none">Still</option><option value="zoom">Slow zoom in</option></select></label>
            <label className="pd-field">Camera bubble here<select value={selected.corner ?? ""} onChange={e => patch({ corner: (e.target.value || undefined) as Corner | undefined })}><option value="">Same as camera</option>{CORNERS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
            <span className="small-note">Drag a slide's left or right edge on the timeline to change when it starts or ends (it snaps to sentences; the slide next to it follows). <kbd>S</kbd> splits it, <kbd>Delete</kbd> removes it (a blank board shows there; set the camera clip to full screen if you like).</span>
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
            {selLocked && <span className="small-note">This lane is locked: unlock it (🔒 on the timeline) to edit.</span>}
            <button className="btn ghost" onClick={doSplit} disabled={!canEdit || t <= selected.start + 0.2 || t >= selected.end - 0.2}>Split at playhead</button>
            {(deletable(selected) || selected.track === "camera") && <button className="btn ghost" onClick={doDelete} disabled={!canEdit}>{selected.track === "camera" ? "Remove camera here" : "Delete"}</button>}
          </div>
        </div>
      </>}
    </div>
  );

  const tl = (
    <div className="panel pd-tl">
      <div className="pd-tools">
        <button className="btn ghost ic" onClick={undo} disabled={!hist.current.past.length} title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
        <button className="btn ghost ic" onClick={redo} disabled={!hist.current.future.length} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↷</button>
        <span className="pd-sep" />
        <button className="btn ghost" onClick={doSplit} disabled={!canEdit || !selected || t <= selected.start + 0.2 || t >= selected.end - 0.2} title="Split the selected clip at the playhead (S or Ctrl+B)">Split <kbd>S</kbd></button>
        <button className="btn ghost" onClick={trimLeft} disabled={!canEdit || !selected || !trimmable(selected) || t <= selected.start || t >= selected.end} title="Cut off the part of the selected clip before the playhead (Q)">Trim left <kbd>Q</kbd></button>
        <button className="btn ghost" onClick={trimRight} disabled={!canEdit || !selected || !trimmable(selected) || t <= selected.start || t >= selected.end} title="Cut off the part of the selected clip after the playhead (W)">Trim right <kbd>W</kbd></button>
        <button className="btn ghost" onClick={doDuplicate} disabled={!canEdit || !selected || !["titles", "sfx", "music"].includes(selected.track)} title="Copy the selected title or sound right after it (Ctrl+D)">Duplicate</button>
        <button className="btn ghost" onClick={doDelete} disabled={!selected && selGap === null} title="Delete the selected clip (Delete). On the camera lane it removes the camera from that piece.">Delete</button>
        <span className="pd-sep" />
        <button className="btn ghost" onClick={marker} title="Add a marker at the playhead, or remove the one there (M)">Marker <kbd>M</kbd></button>
        <button className="btn ghost" onClick={() => addPause(1)} title="Add a 1 s pause at the playhead: the picture holds, sound is silent, everything after moves right. At the very end it adds time after your last word (P)">Add pause <kbd>P</kbd></button>
        <button className={"btn ghost" + (magnet ? " on" : "")} aria-pressed={magnet} onClick={() => setMagnet(!magnet)}>Snap to sentences</button>
        {hint && <span className="pd-toolhint" role="status">{hint}</span>}
        <span className="pd-spacer" />
        <button className="btn ghost ic" onClick={() => zoomBy(0.8)} title="Zoom out (−)" aria-label="Zoom out">−</button>
        <label className="pd-zoom"><span className="sr">Zoom</span><input type="range" min={1} max={60} step={0.5} value={zoom} onChange={e => { setZoom(+e.target.value); store.set("tp.zoom", +e.target.value); }} /></label>
        <button className="btn ghost ic" onClick={() => zoomBy(1.25)} title="Zoom in (+)" aria-label="Zoom in">+</button>
        <button className={"btn ghost" + (!zoomSet ? " on" : "")} aria-pressed={!zoomSet} onClick={() => { setZoom(0); store.set("tp.zoom", 0); }}>Fit</button>
        <button className="btn ghost danger" onClick={() => void deleteVideo()} title="Send the exported files to the Recycle Bin and start the timeline over">Delete video…</button>
        <button className="btn primary" onClick={() => setPane("export")}>Polish &amp; export →</button>
      </div>
      <div className="pd-scroll">
        <div className="pd-heads">
          <div className="pd-rulerhead">Chapters</div>
          {TRACKS.map(tr => {
            const locked = isLocked(prod, tr.id), off = isOff(prod, tr.id), audio = tr.id === "music" || tr.id === "sfx";
            return (
              <div key={tr.id} className={"pd-head" + (off ? " off" : "")}>
                <span className="tag">{tr.tag}</span><span className="nm">{tr.name}</span>
                <button className={"pd-hb" + (locked ? " on" : "")} aria-pressed={locked} title={locked ? "Unlock this lane" : "Lock this lane (no edits)"}
                  onClick={() => setProd(q => setTrack(q, tr.id, { locked: !locked }))}>{locked ? "🔒" : "🔓"}</button>
                {canTurnOff(tr.id) && <button className={"pd-hb" + (off ? " on" : "")} aria-pressed={off}
                  title={off ? (audio ? "Unmute this lane" : "Show this lane") : audio ? "Mute this lane (preview and export)" : "Hide this lane (preview and export)"}
                  onClick={() => setProd(q => setTrack(q, tr.id, { off: !off }))}>{audio ? (off ? "🔇" : "🔊") : off ? "◌" : "◉"}</button>}
              </div>
            );
          })}
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
              {(prod.markers ?? []).map(m => <span key={m} className="pd-mark" style={{ left: m * zoom }} title={`Marker at ${fmtMs(m)} (M at the playhead removes it)`} />)}
            </div>
            {TRACKS.map(tr => (
              <div key={tr.id} className={"pd-lane" + (isOff(prod, tr.id) ? " off" : "") + (isLocked(prod, tr.id) ? " locked" : "")} onClick={laneClick}>
                {clipsOn(prod, tr.id).map(c => (
                  <button key={c.id} className={"pd-clip " + CLIP_COLOURS[tr.id] + (sel === c.id ? " sel" : "") + (c.track === "titles" || c.track === "sfx" || c.track === "music" ? " movable" : "")}
                    style={{ left: c.start * zoom, width: Math.max(4, (c.end - c.start) * zoom) }} title={clipLabel(c)}
                    onPointerDown={e => onClipDown(e, c)} onPointerMove={onClipMove} onPointerUp={onClipUp}>
                    {clipLabel(c)}
                    {trimmable(c) && !isLocked(prod, c.track) && (c.end - c.start) * zoom > 14 && <>
                      <span className="pd-trim l" title="Drag to change where it starts" onPointerDown={e => onEdgeDown(e, c, "start")} />
                      <span className="pd-trim r" title="Drag to change where it ends" onPointerDown={e => onEdgeDown(e, c, "end")} />
                    </>}
                  </button>
                ))}
                {tr.id === "voice" && gapSpans(prod).map(g => (
                  <button key={"gap" + g.i} className={"pd-gap" + (selGap === g.i ? " sel" : "")} style={{ left: g.start * zoom, width: Math.max(6, g.dur * zoom) }}
                    title={`Pause, ${g.dur.toFixed(1)} s: click to change its length`} onPointerDown={e => { e.stopPropagation(); setSel(null); setSelGap(g.i); }}>
                    {g.dur * zoom > 40 ? `Pause ${g.dur.toFixed(1)}s` : "‖"}
                  </button>
                ))}
              </div>
            ))}
            {(prod.markers ?? []).map(m => <div key={m} className="pd-mark-line" style={{ left: m * zoom }} aria-hidden="true" />)}
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
          <button className="btn primary pd-go" onClick={() => void doExport()} disabled={!!job?.running || building || needsRebuild}>
            {exporting ? `${mine!.stage}… ${mine!.stage === "Exporting" ? Math.round(mine!.progress * 100) + "%" : ""}` : job?.running ? "Another export is running…" : `Export ${Object.values(outs).filter(Boolean).length} file${Object.values(outs).filter(Boolean).length === 1 ? "" : "s"}`}
          </button>
          {exporting && <div className="vsetup"><div className="bar"><b style={{ width: `${Math.round((mine!.stage === "Exporting" ? mine!.progress : 0) * 100)}%` }} /></div></div>}
          {exporting && <span className="small-note">You can switch to another tab: the export carries on and the files show here when it is done.</span>}
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
      {(error || mine?.error) && <div className="vsetup err">{error || mine?.error}</div>}
    </section>
  );
}
