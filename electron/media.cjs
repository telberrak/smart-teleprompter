// FFmpeg work, main process side: make takes seekable, find silences, export the final cut.
// FFmpeg itself comes from npm (@ffmpeg-installer/ffmpeg): nothing to install by hand.
const { app, ipcMain, protocol, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { takesDir } = require("./takes.cjs");

const ffmpegPath = () => require("@ffmpeg-installer/ffmpeg").path.replace("app.asar", "app.asar.unpacked");

/** Run FFmpeg; resolves with its log (stderr). onLine gets each log line as it comes. */
function ffmpeg(args, onLine, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ["-hide_banner", "-nostdin", ...args], { windowsHide: true, cwd });
    let log = "", part = "";
    p.stderr.on("data", d => {
      const s = d.toString(); log += s;
      if (onLine) { part += s; const lines = part.split(/\r|\n/); part = lines.pop(); lines.forEach(onLine); }
    });
    p.on("error", reject);
    p.on("close", code => {
      if (code === 0) return resolve(log);
      // Keep the whole log next to the files, and name the real cause (it is often above the last lines).
      try { fs.writeFileSync(path.join(cwd || process.cwd(), "ffmpeg-error.log"), `ffmpeg ${args.join(" ")}\n\n${log}`); } catch { /* read-only folder */ }
      const lines = log.split(/\r?\n/).filter(Boolean);
      const cause = lines.filter(l => /cannot|no such|invalid|unable|not found|error/i.test(l) && !/^\s*(Stream|Error while|Conversion failed)/.test(l)).slice(0, 2);
      reject(new Error(`FFmpeg failed (${code}): ${[...new Set([...cause, ...lines.slice(-2)])].join(" | ")}`));
    });
  });
}

const durationOf = log => { const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(log); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; };

/** MediaRecorder files have no index or duration; a stream copy adds both (fast, lossless). */
async function makeSeekable(file) {
  const tmp = file.replace(/\.webm$/, ".fixing.webm");
  await ffmpeg(["-y", "-i", file, "-c", "copy", tmp]);
  fs.renameSync(tmp, file);
}

/** Silent stretches of at least 0.2 s, quieter than -35 dB. */
async function findSilences(file) {
  const log = await ffmpeg(["-i", file, "-vn", "-af", "silencedetect=noise=-35dB:d=0.2", "-f", "null", "-"]);
  const duration = durationOf(log);
  const out = []; let open = null;
  for (const line of log.split(/\r?\n/)) {
    const a = /silence_start: (-?[\d.]+)/.exec(line);
    if (a) { open = Math.max(0, +a[1]); continue; }
    const b = /silence_end: ([\d.]+)/.exec(line);
    if (b && open !== null) { out.push([open, +b[1]]); open = null; }
  }
  if (open !== null) out.push([open, duration]);
  return { duration, silences: out };
}

/** All takes of a script, analysed once (results cached in each take's .json). */
async function listTakes(scriptPath) {
  const dir = takesDir(scriptPath);
  if (!fs.existsSync(dir)) return { dir, takes: [] };
  const takes = [];
  for (const f of fs.readdirSync(dir).filter(f => /^take-\d+\.json$/.test(f)).sort()) {
    const json = path.join(dir, f);
    let meta;
    try { meta = JSON.parse(fs.readFileSync(json, "utf8")); } catch { continue; }
    const file = path.join(dir, meta.video || f.replace(/\.json$/, ".webm"));
    if (!fs.existsSync(file)) continue;
    if (!meta.analysed) {
      try {
        if (/\.webm$/.test(file)) await makeSeekable(file);
        const { duration, silences } = await findSilences(file);
        meta = { ...meta, seconds: duration || meta.seconds, silences, analysed: true };
        fs.writeFileSync(json, JSON.stringify(meta, null, 2));
      } catch (err) {
        meta = { ...meta, silences: [], error: String(err.message || err) };
      }
    }
    takes.push({
      file, take: meta.take, seconds: meta.seconds, video: /^video\//.test(meta.mimeType || "video/"),
      lag: meta.follow?.by === "voice" ? (meta.follow.lagSeconds ?? 2.4) : 0,
      sentences: meta.sentences || [], silences: meta.silences || [], error: meta.error,
    });
  }
  return { dir, takes };
}

/** One MP4 from the chosen segments, in order, 1080p30, H.264 + AAC. */
async function exportCut(scriptPath, segs, onProgress, opts = {}) {
  if (!segs.length) throw new Error("Nothing to export yet: record some sentences first.");
  const dir = takesDir(scriptPath);
  const base = scriptPath ? path.basename(scriptPath).replace(/\.[^.]+$/, "") : "cut";
  const out = path.join(dir, `${base}-cut.mp4`);
  // One input per segment, cut with accurate input seeking (-ss/-t before -i).
  const args = ["-y"];
  const parts = [], labels = [];
  const fade = 0.02;
  segs.forEach((s, i) => {
    const d = Math.max(0.05, s.end - s.start);
    args.push("-ss", s.start.toFixed(3), "-t", d.toFixed(3), "-i", s.file);
    parts.push(s.video
      ? `[${i}:v]setpts=PTS-STARTPTS,fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v${i}]`
      : `color=c=black:s=1920x1080:r=30:d=${d.toFixed(3)},format=yuv420p,setsar=1[v${i}]`);
    parts.push(`[${i}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=end=${d.toFixed(3)},afade=t=in:d=${fade},afade=t=out:st=${(d - fade).toFixed(3)}:d=${fade}[a${i}]`);
    labels.push(`[v${i}][a${i}]`);
  });
  const graph = `${parts.join(";")};${labels.join("")}concat=n=${segs.length}:v=1:a=1[v][a]`;
  const graphFile = path.join(dir, ".cut-graph.txt");
  fs.writeFileSync(graphFile, graph); // long graphs overflow the Windows command line
  args.push("-filter_complex_script", graphFile, "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out);
  const total = segs.reduce((a, s) => a + (s.end - s.start), 0);
  await ffmpeg(args, line => {
    const m = /time=(\d+):(\d+):([\d.]+)/.exec(line);
    if (m) onProgress(Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / total));
  });
  try { fs.unlinkSync(graphFile); } catch { /* fine */ }
  fs.writeFileSync(out.replace(/\.mp4$/, ".json"), JSON.stringify({ video: path.basename(out), seconds: +total.toFixed(2), segments: segs }, null, 2));
  // Captions: an .srt next to the video, and optionally a copy with them burnt in.
  let srt = null, captioned = null, captionError = "";
  if (opts.srt) {
    srt = out.replace(/\.mp4$/, ".srt");
    fs.writeFileSync(srt, opts.srt);
    if (opts.burn) {
      captioned = out.replace(/\.mp4$/, "-captioned.mp4");
      const style = "FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=2,Shadow=0,MarginV=40";
      try {
        // Run inside the folder so the subtitles filter gets a plain file name (no Windows drive colon to escape).
        await ffmpeg(["-y", "-i", path.basename(out), "-vf", `subtitles=${path.basename(srt)}:force_style='${style}'`,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "copy", "-movflags", "+faststart", path.basename(captioned)],
          line => { const m = /time=(\d+):(\d+):([\d.]+)/.exec(line); if (m) onProgress(Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / total)); }, dir);
      } catch (err) { captioned = null; captionError = String(err.message || err); }
    }
  }
  return { file: out, seconds: total, srt, captioned, captionError };
}

const CAPTION_STYLE = "FontName=Arial,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=2,Shadow=0,MarginV=12"; // smaller and lower than the cut copy: stays under the slide
const timeOf = line => { const m = /time=(\d+):(\d+):([\d.]+)/.exec(line); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null; };
// Same pieces of the same files, in the same order (other fields, like a read's id, do not change the video).
const cutShape = list => JSON.stringify((list || []).map(s => [path.basename(s.file), +(+s.start).toFixed(3), +(+s.end).toFixed(3)]));
const sameSegs = (a, b) => cutShape(a) === cutShape(b);

/** Is there a cut for these segments already? Never builds anything. */
function cutStatus(scriptPath, segs) {
  const dir = takesDir(scriptPath);
  const base = scriptPath ? path.basename(scriptPath).replace(/\.[^.]+$/, "") : "cut";
  const out = path.join(dir, `${base}-cut.mp4`), json = out.replace(/\.mp4$/, ".json");
  try {
    const prev = JSON.parse(fs.readFileSync(json, "utf8"));
    if (!fs.existsSync(out)) return null;
    return { file: out, seconds: prev.seconds, fresh: sameSegs(prev.segments, segs), version: fs.statSync(out).mtimeMs };
  } catch { return null; }
}

/** The cut for these segments: reuse the last export when nothing changed, else make it. */
async function ensureCut(scriptPath, segs, onProgress, srt) {
  const dir = takesDir(scriptPath);
  const base = scriptPath ? path.basename(scriptPath).replace(/\.[^.]+$/, "") : "cut";
  const out = path.join(dir, `${base}-cut.mp4`), json = out.replace(/\.mp4$/, ".json");
  try {
    const prev = JSON.parse(fs.readFileSync(json, "utf8"));
    if (fs.existsSync(out) && sameSegs(prev.segments, segs)) {
      const srtFile = srt ? out.replace(/\.mp4$/, ".srt") : null;
      if (srtFile) fs.writeFileSync(srtFile, srt);
      return { file: out, seconds: prev.seconds, srt: srtFile };
    }
  } catch { /* no previous cut */ }
  return exportCut(scriptPath, segs, onProgress, { srt });
}

/** FFmpeg filter graph: slides full screen, camera full screen in "camera" scenes, round camera bubble over slides. */
function whiteboardGraph(scenes, { hasCamera, slideInput, maskInput, ringInput, total, srt, bubble = {} }) {
  const BUBBLE = bubble.size || 360, MARGIN = bubble.margin || 56, corner = bubble.corner || "br";
  const parts = [], labels = [];
  const camScenes = scenes.filter(s => s.kind === "camera");
  const slideScenes = scenes.filter(s => s.kind === "slide");
  const showBubble = hasCamera && slideScenes.length > 0;
  const camUses = camScenes.length + (showBubble ? 1 : 0);
  let ci = 0;
  if (camUses) parts.push(`[0:v]split=${camUses}${Array.from({ length: camUses }, (_, i) => `[c${i}]`).join("")}`);
  scenes.forEach((s, i) => {
    const d = (s.end - s.start).toFixed(3);
    if (s.kind === "camera") parts.push(`[c${ci++}]trim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},setpts=PTS-STARTPTS,fps=30,format=yuv420p,setsar=1[s${i}]`);
    else parts.push(`[${slideInput(i)}:v]fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p,setsar=1,trim=duration=${d},setpts=PTS-STARTPTS[s${i}]`);
    labels.push(`[s${i}]`);
  });
  parts.push(`${labels.join("")}concat=n=${scenes.length}:v=1:a=0[bg]`);
  let last = "bg";
  if (showBubble) {
    const on = slideScenes.map(s => `between(t,${s.start.toFixed(3)},${s.end.toFixed(3)})`).join("+");
    const pos = `x=${corner[1] === "l" ? MARGIN : `W-w-${MARGIN}`}:y=${corner[0] === "t" ? MARGIN : `H-h-${MARGIN}`}`;
    parts.push(`[c${ci}]crop=ih:ih,scale=${BUBBLE}:${BUBBLE},setsar=1,format=yuva420p[cs]`);
    parts.push(`[${maskInput}:v]scale=${BUBBLE}:${BUBBLE},format=gray[mk]`);
    parts.push(`[cs][mk]alphamerge[bub]`);
    parts.push(`[bg][bub]overlay=${pos}:enable='${on}'[o1]`);
    parts.push(`[${ringInput}:v]format=rgba[rg]`);
    parts.push(`[o1][rg]overlay=${pos}:enable='${on}'[o2]`);
    last = "o2";
  }
  parts.push(`[${last}]${srt ? `subtitles=${srt}:force_style='${CAPTION_STYLE}',` : ""}format=yuv420p,trim=duration=${total.toFixed(3)}[v]`);
  return parts.join(";\n");
}

/**
 * The finished whiteboard video (<script>-whiteboard.mp4), and the same storyboard as a
 * timeline.json + a Remotion project (<script>-remotion) to restyle it in code.
 * opts: { timeline, images: {name: bytes}, mask, ring, srt, captions, remotion }
 */
async function exportWhiteboard(scriptPath, segs, onProgress, opts) {
  if (!segs.length) throw new Error("Nothing to export yet: record some sentences first.");
  const dir = takesDir(scriptPath);
  const base = scriptPath ? path.basename(scriptPath).replace(/\.[^.]+$/, "") : "cut";
  const tl = opts.timeline;
  const cut = await ensureCut(scriptPath, segs, p => onProgress(p * 0.4), opts.srt);
  const cutName = path.basename(cut.file);

  // Slide pictures and the bubble mask, next to the takes.
  const slidesDir = `${base}-slides`;
  fs.mkdirSync(path.join(dir, slidesDir), { recursive: true });
  for (const [name, bytes] of Object.entries(opts.images || {})) fs.writeFileSync(path.join(dir, slidesDir, name), Buffer.from(bytes));
  fs.writeFileSync(path.join(dir, slidesDir, "bubble-mask.png"), Buffer.from(opts.mask));
  fs.writeFileSync(path.join(dir, slidesDir, "bubble-ring.png"), Buffer.from(opts.ring));

  // Timeline next to the cut (paths relative to the takes folder).
  const rel = n => `${slidesDir}/${n}`;
  const timelineFile = path.join(dir, `${base}-timeline.json`);
  fs.writeFileSync(timelineFile, JSON.stringify({ ...tl, video: cutName, scenes: tl.scenes.map(s => (s.image ? { ...s, image: rel(s.image) } : s)) }, null, 2));

  // FFmpeg, run inside the takes folder so every path is a plain relative name.
  const total = tl.seconds;
  const args = ["-y", "-i", cutName];
  const slideIdx = {};
  let n = 1;
  tl.scenes.forEach((s, i) => {
    if (s.kind !== "slide") return;
    args.push("-loop", "1", "-framerate", "30", "-t", (s.end - s.start + 0.1).toFixed(3), "-i", rel(s.image));
    slideIdx[i] = n++;
  });
  const maskInput = n++, ringInput = n++;
  args.push("-loop", "1", "-framerate", "30", "-t", (total + 0.1).toFixed(3), "-i", rel("bubble-mask.png"));
  args.push("-loop", "1", "-framerate", "30", "-t", (total + 0.1).toFixed(3), "-i", rel("bubble-ring.png"));
  const hasCamera = segs.some(s => s.video);
  const srt = opts.captions && cut.srt ? path.basename(cut.srt) : null;
  const graph = whiteboardGraph(tl.scenes, { hasCamera, slideInput: i => slideIdx[i], maskInput, ringInput, total, srt, bubble: tl.bubble });
  const graphName = ".whiteboard-graph.txt";
  fs.writeFileSync(path.join(dir, graphName), graph);
  const outName = `${base}-whiteboard.mp4`;
  args.push("-filter_complex_script", graphName, "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
    "-c:a", "copy", "-movflags", "+faststart", outName);
  await ffmpeg(args, line => { const t = timeOf(line); if (t !== null) onProgress(0.4 + 0.6 * Math.min(1, t / total)); }, dir);
  try { fs.unlinkSync(path.join(dir, graphName)); } catch { /* fine */ }

  let remotion = null, remotionError = "";
  if (opts.remotion) {
    try { remotion = writeRemotion(dir, base, tl, cut.file, opts.images); }
    catch (err) { remotionError = String(err.message || err); }
  }
  return { file: path.join(dir, outName), seconds: total, timeline: timelineFile, remotion, remotionError, srt: cut.srt };
}

/** A small Remotion project with this video's timeline, slides and cut in public/. */
function writeRemotion(dir, base, tl, cutFile, images) {
  const proj = path.join(dir, `${base}-remotion`);
  const template = path.join(app.getAppPath(), "remotion-template");
  if (!fs.existsSync(path.join(proj, "package.json"))) {
    fs.cpSync(template, proj, { recursive: true, filter: src => !/node_modules|[\\/]out[\\/]?$/.test(src) });
  }
  const pub = path.join(proj, "public");
  fs.mkdirSync(path.join(pub, "slides"), { recursive: true });
  for (const [name, bytes] of Object.entries(images || {})) fs.writeFileSync(path.join(pub, "slides", name), Buffer.from(bytes));
  const video = path.join(pub, "cut.mp4");
  try { fs.rmSync(video, { force: true }); } catch { /* fine */ }
  try { fs.linkSync(cutFile, video); } catch { fs.copyFileSync(cutFile, video); }
  fs.writeFileSync(path.join(pub, "timeline.json"), JSON.stringify({ ...tl, video: "cut.mp4", scenes: tl.scenes.map(s => (s.image ? { ...s, image: `slides/${s.image}` } : s)) }, null, 2));
  return proj;
}

// take://media/<encoded absolute path>: lets the page play takes (with seeking) from disk.
function registerScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: "take", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
}
function registerProtocol() {
  protocol.handle("take", req => {
    const p = decodeURIComponent(new URL(req.url).pathname.slice(1));
    if (!/\.(webm|mp4|mp3|wav|m4a|aac|ogg|flac|png)$/i.test(p) || !fs.existsSync(p)) return new Response("not found", { status: 404 });
    return serveFile(p, req.headers.get("range"));
  });
}

const TYPES = { webm: "video/webm", mp4: "video/mp4", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac", png: "image/png" };
/**
 * A file with byte-range support. Fetching a file:// URL answers every request with the whole file,
 * which makes a video unseekable: setting currentTime jumps back to the start.
 */
function serveFile(file, range) {
  const size = fs.statSync(file).size;
  const type = TYPES[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream";
  const body = (start, end) => require("node:stream").Readable.toWeb(fs.createReadStream(file, { start, end }));
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (!m[1] && !m[2])) {
    return new Response(body(0, Math.max(0, size - 1)), { status: 200, headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" } });
  }
  let start = m[1] ? +m[1] : Math.max(0, size - +m[2]);
  let end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  return new Response(body(start, end), {
    status: 206,
    headers: { "Content-Type": type, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" },
  });
}

function register() {
  ipcMain.handle("takes:list", (_e, scriptPath) => listTakes(scriptPath));
  ipcMain.handle("export:run", async (e, scriptPath, segs, opts) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return exportCut(scriptPath, segs, p => win?.webContents.send("export:progress", p), opts);
  });
  ipcMain.handle("export:whiteboard", async (e, scriptPath, segs, opts) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return exportWhiteboard(scriptPath, segs, p => win?.webContents.send("export:progress", p), opts);
  });
}

module.exports = { serveFile, register, cutStatus, registerScheme, registerProtocol, ffmpeg, listTakes, exportCut, ensureCut, exportWhiteboard, whiteboardGraph, makeSeekable, findSilences };
