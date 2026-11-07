// FFmpeg work, main process side: make takes seekable, find silences, export the final cut.
// FFmpeg itself comes from npm (@ffmpeg-installer/ffmpeg): nothing to install by hand.
const { ipcMain, protocol, net, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
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
    p.on("close", code => (code === 0 ? resolve(log) : reject(new Error(`FFmpeg failed (${code}): ${log.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ")}`))));
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

// take://media/<encoded absolute path>: lets the page play takes (with seeking) from disk.
function registerScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: "take", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
}
function registerProtocol() {
  protocol.handle("take", req => {
    const p = decodeURIComponent(new URL(req.url).pathname.slice(1));
    if (!/\.(webm|mp4)$/i.test(p) || !fs.existsSync(p)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(p).toString(), { headers: req.headers });
  });
}

function register() {
  ipcMain.handle("takes:list", (_e, scriptPath) => listTakes(scriptPath));
  ipcMain.handle("export:run", async (e, scriptPath, segs, opts) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return exportCut(scriptPath, segs, p => win?.webContents.send("export:progress", p), opts);
  });
}

module.exports = { register, registerScheme, registerProtocol, ffmpeg, listTakes, exportCut, makeSeekable, findSilences };
