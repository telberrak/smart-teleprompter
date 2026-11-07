// Production export, main process side: the finished lesson from the cut, slides, camera,
// titles, captions, music and sound effects, with the sound cleaned and levelled.
//
// Everything runs in the takes folder so every path FFmpeg sees is a plain relative name.
const { ipcMain, dialog, BrowserWindow, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { takesDir } = require("./takes.cjs");
const media = require("./media.cjs");

const BUBBLE = 360, MARGIN = 56;
const CAPTION = {
  clean: "FontName=Arial,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=2,Shadow=0,MarginV=12",
  bold: "FontName=Arial,FontSize=14,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2.5,Shadow=0,MarginV=14",
};
const DUCK = { gentle: "threshold=0.05:ratio=6:attack=20:release=500", strong: "threshold=0.03:ratio=14:attack=10:release=400" };
const f3 = x => (+x).toFixed(3);
const between = list => list.map(c => `between(t,${f3(c.start)},${f3(c.end)})`).join("+");
const pos = corner => `x=${corner[1] === "l" ? MARGIN : `W-w-${MARGIN}`}:y=${corner[0] === "t" ? MARGIN : `H-h-${MARGIN}`}`;
const baseName = scriptPath => (scriptPath ? path.basename(scriptPath).replace(/\.[^.]+$/, "") : "cut");

/** Sound effects, made by FFmpeg itself: nothing to license. */
function sfxSource(sound, volume, delayMs) {
  const d = `adelay=${delayMs}|${delayMs}`;
  if (sound === "pop") return `sine=f=880:d=0.12,afade=t=out:st=0.02:d=0.1,aformat=sample_rates=48000:channel_layouts=stereo,volume=${volume}dB,${d}`;
  // whoosh: pink noise swept through a band, swelling in and out
  return `anoisesrc=d=0.8:c=pink:a=0.6,highpass=f=300,lowpass=f=5000,afade=t=in:d=0.35,afade=t=out:st=0.35:d=0.45,aformat=sample_rates=48000:channel_layouts=stereo,volume=${volume}dB,${d}`;
}

/**
 * The filter graph. inputs: 0 = cut; slides/titles/mask/ring/music are numbered by the caller.
 * Returns the graph text.
 */
function productionGraph(p, ix) {
  const total = p.seconds;
  const clips = t => p.clips.filter(c => c.track === t).sort((a, b) => a.start - b.start);
  const slides = clips("slides"), titles = clips("titles"), cams = clips("camera");
  const voice = clips("voice")[0], music = clips("music")[0], sfx = clips("sfx"), cap = clips("captions")[0];
  const parts = [];

  // 0. Pauses: the cut is cut at each one; the picture holds its last frame and the sound is silent.
  let V = "0:v", A = "0:a";
  const gaps = [...(p.gaps || [])].filter(g => g.dur > 0.01).sort((a, b) => a.cut - b.cut);
  if (gaps.length) {
    const cutLen = total - gaps.reduce((a, g) => a + g.dur, 0);
    const segsOut = [];
    let from = 0;
    for (const g of gaps) {
      if (g.cut - from > 0.02) segsOut.push({ a: from, b: g.cut, pad: g.dur });
      else if (segsOut.length) segsOut[segsOut.length - 1].pad += g.dur;
      else segsOut.push({ a: 0, b: Math.min(0.04, cutLen), pad: g.dur }); // a pause at the very start holds the first frame
      from = Math.max(from, g.cut);
    }
    if (cutLen - from > 0.02) segsOut.push({ a: from, b: null, pad: 0 });
    const k = segsOut.length, cam = !!p.hasCamera;
    if (cam) parts.push(`[0:v]split=${k}${segsOut.map((_, i) => `[gv${i}]`).join("")}`);
    parts.push(`[0:a]aresample=48000,aformat=channel_layouts=stereo,asplit=${k}${segsOut.map((_, i) => `[ga${i}]`).join("")}`);
    segsOut.forEach((x, i) => {
      const rng = `start=${f3(x.a)}${x.b !== null ? `:end=${f3(x.b)}` : ""}`;
      if (cam) parts.push(`[gv${i}]trim=${rng},setpts=PTS-STARTPTS${x.pad ? `,tpad=stop_mode=clone:stop_duration=${f3(x.pad)}` : ""}[gw${i}]`);
      parts.push(`[ga${i}]atrim=${rng},asetpts=PTS-STARTPTS${x.pad ? `,apad=pad_len=${Math.round(x.pad * 48000)}` : ""}[gb${i}]`);
    });
    parts.push(`${segsOut.map((_, i) => (cam ? `[gw${i}]` : "") + `[gb${i}]`).join("")}concat=n=${k}:v=${cam ? 1 : 0}:a=1${cam ? "[tv]" : ""}[ta]`);
    V = "tv"; A = "ta";
  }

  // 1. Background: slides in order, white where there is none.
  const bg = []; let t = 0, gi = 0;
  const gap = d => { if (d > 0.001) { parts.push(`color=c=white:s=1920x1080:r=30:d=${f3(d)},format=yuv420p,setsar=1[g${gi}]`); bg.push(`[g${gi++}]`); } };
  slides.forEach((s, i) => {
    const start = Math.max(t, s.start), end = Math.min(total, s.end), d = end - start;
    if (d <= 0.01) return;
    gap(start - t);
    let chain = `[${ix.slide[i]}:v]fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:white,setsar=1`;
    if (s.motion === "zoom") chain += `,scale=3840:2160,zoompan=z='min(1+0.0006*on,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=30`;
    chain += `,format=yuv420p,trim=duration=${f3(d)},setpts=PTS-STARTPTS`;
    if (s.enter === "fade") chain += `,fade=t=in:st=0:d=0.4:color=white`;
    parts.push(`${chain}[s${i}]`); bg.push(`[s${i}]`);
    t = end;
  });
  gap(total - t);
  parts.push(`${bg.join("")}concat=n=${bg.length}:v=1:a=0[bg]`);
  let last = "bg";

  // 2. Camera: full screen where its layout is full, a round bubble (per corner) where it is a bubble.
  const full = p.hasCamera ? cams.filter(c => c.layout === "full") : [];
  const bubbles = [];
  if (p.hasCamera) for (const c of cams.filter(c => c.layout === "bubble")) {
    // A slide may ask for another corner while it is up: cut the bubble clip at slide edges.
    const edges = [c.start, c.end, ...slides.flatMap(s => [s.start, s.end])].filter(x => x >= c.start && x <= c.end).sort((a, b) => a - b);
    for (let i = 0; i + 1 < edges.length; i++) {
      const a = edges[i], b = edges[i + 1]; if (b - a < 0.01) continue;
      const s = slides.find(x => x.start <= a + 0.001 && x.end >= b - 0.001);
      bubbles.push({ start: a, end: b, corner: (s && s.corner) || c.corner });
    }
  }
  const corners = [...new Set(bubbles.map(b => b.corner))];
  const camUses = (full.length ? 1 : 0) + corners.length;
  if (camUses) parts.push(`[${V}]split=${camUses}${Array.from({ length: camUses }, (_, i) => `[cam${i}]`).join("")}`);
  let ci = 0;
  if (full.length) {
    parts.push(`[cam${ci++}]setsar=1,format=yuv420p[full]`);
    parts.push(`[${last}][full]overlay=0:0:enable='${between(full)}'[vf]`); last = "vf";
  }
  if (corners.length) {
    parts.push(`[${ix.mask}:v]scale=${BUBBLE}:${BUBBLE},format=gray,split=${corners.length}${corners.map((_, i) => `[mk${i}]`).join("")}`);
    parts.push(`[${ix.ring}:v]format=rgba,split=${corners.length}${corners.map((_, i) => `[rg${i}]`).join("")}`);
    corners.forEach((corner, i) => {
      const on = between(bubbles.filter(b => b.corner === corner));
      parts.push(`[cam${ci++}]crop=ih:ih,scale=${BUBBLE}:${BUBBLE},setsar=1,format=yuva420p[cs${i}]`);
      parts.push(`[cs${i}][mk${i}]alphamerge[bub${i}]`);
      parts.push(`[${last}][bub${i}]overlay=${pos(corner)}:enable='${on}'[vb${i}]`);
      parts.push(`[vb${i}][rg${i}]overlay=${pos(corner)}:enable='${on}'[vr${i}]`);
      last = `vr${i}`;
    });
  }

  // 3. Titles, each fading in and out.
  titles.forEach((c, i) => {
    const d = c.end - c.start, fd = Math.min(0.35, d / 3);
    parts.push(`[${ix.title[i]}:v]format=rgba,fade=t=in:st=0:d=${f3(fd)}:alpha=1,fade=t=out:st=${f3(d - fd)}:d=${f3(fd)}:alpha=1,setpts=PTS-STARTPTS+${f3(c.start)}/TB[ti${i}]`);
    parts.push(`[${last}][ti${i}]overlay=0:0:enable='${between([c])}':eof_action=pass[vt${i}]`);
    last = `vt${i}`;
  });

  // 4. Captions, then the final picture.
  const capStyle = cap && cap.style !== "off" && ix.srt ? CAPTION[cap.style] || CAPTION.clean : null;
  parts.push(`[${last}]${capStyle ? `subtitles=${ix.srt}:force_style='${capStyle}',` : ""}format=yuv420p,trim=duration=${f3(total)}[v]`);

  // 5. Sound: voice cleaned, music ducked under it, effects, then levelled to the target loudness.
  const mix = [];
  const vchain = voice && voice.clean
    ? "highpass=f=80,afftdn=nf=-25,acompressor=threshold=-20dB:ratio=3:attack=5:release=120:makeup=2"
    : "anull";
  const duck = music && ix.music !== undefined && music.duck !== "off";
  parts.push(`[${A}]aresample=48000,aformat=channel_layouts=stereo,${vchain}${duck ? ",asplit=2[vo][vsc]" : "[vo]"}`);
  mix.push("[vo]");
  if (music && ix.music !== undefined) {
    const fade = Math.min(music.fadeOut || 3, total / 2);
    parts.push(`[${ix.music}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${music.volume}dB,atrim=0:${f3(total)},asetpts=PTS-STARTPTS,afade=t=in:d=1,afade=t=out:st=${f3(total - fade)}:d=${f3(fade)}${duck ? "[mu0]" : "[mu]"}`);
    if (duck) parts.push(`[mu0][vsc]sidechaincompress=${DUCK[music.duck] || DUCK.gentle}[mu]`);
    mix.push("[mu]");
  }
  sfx.forEach((s, i) => { parts.push(`${sfxSource(s.sound, s.volume, Math.round(s.start * 1000))}[fx${i}]`); mix.push(`[fx${i}]`); });
  const lufs = (voice && voice.loudness) || -14;
  // amix divides every input by the input count: undo that so the voice keeps its level.
  const mixed = mix.length > 1 ? `${mix.join("")}amix=inputs=${mix.length}:duration=first:dropout_transition=0,volume=${mix.length}` : `${mix[0]}anull`;
  parts.push(`${mixed},atrim=0:${f3(total)},loudnorm=I=${lufs}:TP=-1.5:LRA=11,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[a]`);
  return parts.join(";\n");
}

/** Write a file, waiting a moment and trying again while Windows has it locked. */
function writeRetry(file, data) {
  for (let i = 0; ; i++) {
    try { fs.writeFileSync(file, data); return; } catch (e) {
      if (i >= 8 || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1));
    }
  }
}

/**
 * opts: { production, slides: {name: bytes} (one per slide clip, in order: slide-<i>.png),
 *         titles: [bytes] (one per title clip, in start order), mask, ring, srt, description,
 *         thumbnail?: { png, at, corner }, outputs: { mp4, srt, txt, png } }
 */
async function exportProduction(scriptPath, segs, onProgress, opts) {
  const dir = takesDir(scriptPath), base = baseName(scriptPath);
  const p = opts.production;
  const cut = await media.ensureCut(scriptPath, segs, x => onProgress(x * 0.25), opts.srt);
  const work = `${base}-production`;
  fs.mkdirSync(path.join(dir, work), { recursive: true });
  // Drawing pictures go in a new folder each export: on Windows a file that was just deleted can stay
  // locked (antivirus, indexer) and writing the same name again fails with EPERM.
  // Earlier exports' folders (and loose pictures from older versions) are removed when Windows lets us.
  for (const f of fs.readdirSync(path.join(dir, work))) {
    if (/^draw-\d+$/.test(f) || /^slide-\d+-\d+\.jpg$/.test(f)) {
      try { fs.rmSync(path.join(dir, work, f), { recursive: true, force: true }); } catch { /* still locked: next time */ }
    }
  }
  const drawDir = `draw-${Date.now()}`;
  const put = (name, bytes) => { writeRetry(path.join(dir, work, name), Buffer.from(bytes)); return `${work}/${name}`; };
  const out = { srt: null, txt: null, png: null, file: null };

  // Side files first: they are quick.
  if (opts.outputs.srt !== false && cut.srt) out.srt = cut.srt;
  if (opts.outputs.txt !== false && opts.description) { out.txt = path.join(dir, `${base}-description.txt`); fs.writeFileSync(out.txt, opts.description); }

  const total = p.seconds;
  const slides = p.clips.filter(c => c.track === "slides").sort((a, b) => a.start - b.start);
  const titles = p.clips.filter(c => c.track === "titles").sort((a, b) => a.start - b.start);
  const music = p.clips.find(c => c.track === "music");
  const args = ["-y", "-i", path.basename(cut.file)];
  let n = 1;
  const ix = { slide: [], title: [] };
  slides.forEach((s, i) => {
    const pic = opts.slides[i];
    if (Array.isArray(pic)) {
      // Drawing in: pictures with their own durations, through the concat demuxer.
      const lines = ["ffconcat version 1.0"];
      pic.forEach((f, k) => {
        const name = `slide-${i + 1}-${String(k + 1).padStart(4, "0")}.jpg`;
        if (k === 0) fs.mkdirSync(path.join(dir, work, drawDir), { recursive: true });
        put(`${drawDir}/${name}`, f.img);
        lines.push(`file '${name}'`, `duration ${f.dur.toFixed(4)}`);
      });
      // The last picture is listed again so its duration counts.
      lines.push(`file 'slide-${i + 1}-${String(pic.length).padStart(4, "0")}.jpg'`);
      writeRetry(path.join(dir, work, drawDir, `slide-${i + 1}.txt`), lines.join("\n") + "\n");
      args.push("-f", "concat", "-safe", "0", "-i", `${work}/${drawDir}/slide-${i + 1}.txt`);
    } else {
      args.push("-loop", "1", "-framerate", "30", "-t", f3(s.end - s.start + 0.2), "-i", put(`slide-${i + 1}.png`, pic));
    }
    ix.slide.push(n++);
  });
  titles.forEach((c, i) => {
    args.push("-loop", "1", "-framerate", "30", "-t", f3(c.end - c.start + 0.1), "-i", put(`title-${i + 1}.png`, opts.titles[i]));
    ix.title.push(n++);
  });
  args.push("-loop", "1", "-framerate", "30", "-t", f3(total + 0.2), "-i", put("bubble-mask.png", opts.mask)); ix.mask = n++;
  args.push("-loop", "1", "-framerate", "30", "-t", f3(total + 0.2), "-i", put("bubble-ring.png", opts.ring)); ix.ring = n++;
  if (music && music.file && fs.existsSync(music.file)) { args.push("-stream_loop", "-1", "-i", music.file); ix.music = n++; }
  if (cut.srt) ix.srt = path.basename(cut.srt);

  const graph = productionGraph({ ...p, hasCamera: segs.some(s => s.video) }, ix);
  fs.writeFileSync(path.join(dir, work, "graph.txt"), graph); // kept for troubleshooting
  if (opts.outputs.mp4 !== false) {
    const name = `${base}-final.mp4`;
    args.push("-filter_complex_script", `${work}/graph.txt`, "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-t", f3(total), name);
    await media.ffmpeg(args, line => {
      const m = /time=(\d+):(\d+):([\d.]+)/.exec(line);
      if (m) onProgress(0.25 + 0.7 * Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / total));
    }, dir);
    out.file = path.join(dir, name);
    // The drawing pictures are only needed while FFmpeg runs.
    try { fs.rmSync(path.join(dir, work, drawDir), { recursive: true, force: true }); } catch { /* removed next export */ }
  }

  // Thumbnail: the drawn background, plus a big round crop of your face from the chosen moment.
  if (opts.outputs.png !== false && opts.thumbnail) {
    const th = opts.thumbnail, size = 600, m = 90;
    const bgName = put("thumbnail-bg.png", th.png);
    const big = put("thumbnail-mask.png", opts.mask);
    const x = th.corner[1] === "l" ? m : `W-w-${m}`, y = th.corner[0] === "t" ? m : `H-h-${m}`;
    const name = `${base}-thumbnail.png`;
    const hasCam = segs.some(s => s.video);
    const g = hasCam
      ? `[1:v]crop=ih:ih,scale=${size}:${size},format=yuva420p[f];[2:v]scale=${size}:${size},format=gray[k];[f][k]alphamerge[b];[0:v][b]overlay=${x}:${y},scale=1280:720[o]`
      : `[0:v]scale=1280:720[o]`;
    const targs = ["-y", "-i", bgName];
    if (hasCam) targs.push("-ss", f3(Math.max(0, Math.min(total - 0.1, th.at))), "-i", path.basename(cut.file), "-i", big);
    targs.push("-filter_complex", g, "-map", "[o]", "-frames:v", "1", name);
    await media.ffmpeg(targs, null, dir);
    out.png = path.join(dir, name);
  }
  fs.writeFileSync(path.join(dir, `${base}-production.json`), JSON.stringify(p, null, 2));
  onProgress(1);
  return { ...out, seconds: total };
}

/**
 * The vertical Short's graph. Each piece of the cut gets its own 9:16 layout (slide on top and
 * camera below, camera alone, or slide alone), then the pieces are joined, the header laid over,
 * the captions burnt in and the sound levelled.
 * ix: { slide: [input index or null per piece], header, ass }
 */
function shortGraph(s, ix) {
  const L = s.layout, k = s.pieces.length, parts = [];
  if (s.hasCamera) parts.push(`[0:v]split=${k}${s.pieces.map((_, i) => `[cv${i}]`).join("")}`);
  parts.push(`[0:a]asplit=${k}${s.pieces.map((_, i) => `[ca${i}]`).join("")}`);
  const join = [];
  s.pieces.forEach((p, i) => {
    const d = p.to - p.from, cut = `trim=start=${f3(p.from)}:end=${f3(p.to)},setpts=PTS-STARTPTS`;
    const kind = !s.hasCamera ? "slide" : p.step && ix.slide[i] != null ? "both" : "camera";
    const sl = ix.slide[i];
    if (kind === "camera") {
      parts.push(`[cv${i}]${cut},fps=30,crop=ih*9/16:ih,scale=1080:1920,setsar=1,format=yuv420p[p${i}]`);
    } else {
      parts.push(`color=c=${s.background}:s=1080x1920:r=30:d=${f3(d)},format=yuv420p,setsar=1[bg${i}]`);
      const sy = kind === "slide" ? Math.round((1920 - L.slide.h) / 2) : L.slide.y;
      parts.push(`[${sl}:v]fps=30,scale=${L.slide.w}:${L.slide.h},setsar=1,format=yuv420p,trim=duration=${f3(d)},setpts=PTS-STARTPTS[sl${i}]`);
      if (kind === "slide") {
        parts.push(`[bg${i}][sl${i}]overlay=${L.slide.x}:${sy}:shortest=1,format=yuv420p[p${i}]`);
      } else {
        parts.push(`[bg${i}][sl${i}]overlay=${L.slide.x}:${sy}:shortest=1[bs${i}]`);
        parts.push(`[cv${i}]${cut},fps=30,crop=ih*1080/${L.camera.h}:ih,scale=1080:${L.camera.h},setsar=1[cm${i}]`);
        parts.push(`[bs${i}][cm${i}]overlay=0:${L.camera.y}:shortest=1,format=yuv420p[p${i}]`);
      }
    }
    parts.push(`[ca${i}]a${cut.replace("setpts", "asetpts")},aresample=48000,aformat=channel_layouts=stereo[a${i}]`);
    join.push(`[p${i}][a${i}]`);
  });
  parts.push(`${join.join("")}concat=n=${k}:v=1:a=1[cv][ca]`);
  parts.push(`[ix_header]format=rgba[hd]`.replace("ix_header", `${ix.header}:v`));
  parts.push(`[cv][hd]overlay=0:0:shortest=1${ix.ass ? `,subtitles=${ix.ass}` : ""},format=yuv420p[v]`);
  const vchain = s.clean !== false ? "highpass=f=80,afftdn=nf=-25,acompressor=threshold=-20dB:ratio=3:attack=5:release=120:makeup=2," : "";
  parts.push(`[ca]${vchain}loudnorm=I=${s.loudness || -14}:TP=-1.5:LRA=11,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[a]`);
  return parts.join(";\n");
}

/** opts: { pieces, layout, hasCamera?, background, loudness, clean, slides: [bytes|null per piece], header: bytes, ass } */
async function exportShort(scriptPath, segs, onProgress, opts) {
  const dir = takesDir(scriptPath), base = baseName(scriptPath);
  const cut = await media.ensureCut(scriptPath, segs, x => onProgress(x * 0.2), null);
  const work = `${base}-short`;
  fs.mkdirSync(path.join(dir, work), { recursive: true });
  const put = (name, bytes) => { fs.writeFileSync(path.join(dir, work, name), typeof bytes === "string" ? bytes : Buffer.from(bytes)); return `${work}/${name}`; };
  const pieces = opts.pieces.filter(p => p.to - p.from > 0.05);
  if (!pieces.length) throw new Error("Pick at least one sentence for the Short.");
  const total = pieces.reduce((a, p) => a + (p.to - p.from), 0);
  const hasCamera = segs.some(s => s.video);
  const args = ["-y", "-i", path.basename(cut.file)];
  let n = 1;
  const ix = { slide: [] };
  pieces.forEach((p, i) => {
    const png = opts.slides[opts.pieces.indexOf(p)];
    if (png && (p.step || !hasCamera)) {
      args.push("-loop", "1", "-framerate", "30", "-t", f3(p.to - p.from + 0.2), "-i", put(`slide-${i + 1}.png`, png));
      ix.slide.push(n++);
    } else ix.slide.push(null);
  });
  args.push("-loop", "1", "-framerate", "30", "-t", f3(total + 0.2), "-i", put("header.png", opts.header)); ix.header = n++;
  if (opts.ass) ix.ass = put("captions.ass", opts.ass);
  const graph = shortGraph({ ...opts, pieces, hasCamera }, ix);
  fs.writeFileSync(path.join(dir, work, "graph.txt"), graph);
  const name = `${base}-short.mp4`;
  args.push("-filter_complex_script", `${work}/graph.txt`, "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-t", f3(total), name);
  await media.ffmpeg(args, line => {
    const m = /time=(\d+):(\d+):([\d.]+)/.exec(line);
    if (m) onProgress(0.2 + 0.8 * Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / total));
  }, dir);
  onProgress(1);
  return { file: path.join(dir, name), seconds: +total.toFixed(3) };
}

/** Everything Production wrote for a script (the recordings and the Review cut are not touched). */
function productionFiles(scriptPath) {
  const dir = takesDir(scriptPath), base = baseName(scriptPath);
  // The cut too, so the next build starts from your takes.
  return [`${base}-cut.mp4`, `${base}-cut.json`, `${base}-cut.srt`, `${base}-captions.srt`, `${base}-final.mp4`, `${base}-short.mp4`, `${base}-thumbnail.png`, `${base}-description.txt`, `${base}-production.json`, `${base}-production`, `${base}-short`]
    .map(f => path.join(dir, f)).filter(f => fs.existsSync(f));
}

function register() {
  // The cut the preview plays (made, or reused if it has not changed).
  ipcMain.handle("production:cut", async (e, scriptPath, segs) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await media.ensureCut(scriptPath, segs, x => win?.webContents.send("export:progress", x), null);
    // The file's time tells the preview to load the new video, not a cached copy of the old one.
    return { file: r.file, seconds: r.seconds, version: fs.statSync(r.file).mtimeMs };
  });
  ipcMain.handle("production:pickMusic", async () => {
    const r = await dialog.showOpenDialog({ title: "Choose a music file you own or have a licence for",
      filters: [{ name: "Audio", extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac"] }], properties: ["openFile"] });
    return r.canceled ? null : r.filePaths[0] || null;
  });
  ipcMain.handle("production:export", async (e, scriptPath, segs, opts) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return exportProduction(scriptPath, segs, x => win?.webContents.send("export:progress", x), opts);
  });
  ipcMain.handle("production:cutStatus", (_e, scriptPath, segs) => media.cutStatus(scriptPath, segs));
  ipcMain.handle("production:files", (_e, scriptPath) => productionFiles(scriptPath));
  ipcMain.handle("production:delete", async (_e, scriptPath) => {
    const files = productionFiles(scriptPath);
    for (const f of files) await shell.trashItem(f);
    return files;
  });
  ipcMain.handle("production:short", async (e, scriptPath, segs, opts) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return exportShort(scriptPath, segs, x => win?.webContents.send("export:progress", x), opts);
  });
}

module.exports = { register, productionFiles, exportProduction, productionGraph, exportShort, shortGraph };
