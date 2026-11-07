// Production export, main process side: the finished lesson from the cut, slides, camera,
// titles, captions, music and sound effects, with the sound cleaned and levelled.
//
// Everything runs in the takes folder so every path FFmpeg sees is a plain relative name.
const { ipcMain, dialog, BrowserWindow } = require("electron");
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
  if (camUses) parts.push(`[0:v]split=${camUses}${Array.from({ length: camUses }, (_, i) => `[cam${i}]`).join("")}`);
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
  parts.push(`[0:a]aresample=48000,aformat=channel_layouts=stereo,${vchain}${duck ? ",asplit=2[vo][vsc]" : "[vo]"}`);
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
  parts.push(`${mixed},atrim=0:${f3(total)},loudnorm=I=${lufs}:TP=-1.5:LRA=11,aresample=48000[a]`);
  return parts.join(";\n");
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
  const put = (name, bytes) => { fs.writeFileSync(path.join(dir, work, name), Buffer.from(bytes)); return `${work}/${name}`; };
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
    args.push("-loop", "1", "-framerate", "30", "-t", f3(s.end - s.start + 0.2), "-i", put(`slide-${i + 1}.png`, opts.slides[i]));
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

function register() {
  // The cut the preview plays (made, or reused if it has not changed).
  ipcMain.handle("production:cut", async (e, scriptPath, segs) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await media.ensureCut(scriptPath, segs, x => win?.webContents.send("export:progress", x), null);
    return { file: r.file, seconds: r.seconds };
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
}

module.exports = { register, exportProduction, productionGraph };
