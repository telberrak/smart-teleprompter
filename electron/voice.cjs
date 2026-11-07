// Voice following, main process side: the whisper.cpp engine (prebuilt Node addon, runs on
// the CPU, nothing leaves the computer) and its speech model, downloaded once on first use.
const { app, dialog, ipcMain, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

// Speech models (whisper.cpp ggml, English only), downloaded on demand. Smaller = faster, larger = more accurate.
const HF = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";
const MODELS = {
  "tiny.en": { file: "ggml-tiny.en.bin", mb: 75, minBytes: 60e6, label: "Tiny", note: "fastest, a few more mistakes" },
  "base.en": { file: "ggml-base.en.bin", mb: 142, minBytes: 100e6, label: "Base", note: "fast and accurate (default)" },
  "small.en": { file: "ggml-small.en.bin", mb: 466, minBytes: 400e6, label: "Small", note: "most accurate, needs a good graphics card" },
};
const DEFAULT_MODEL = "base.en";

const modelDir = () => path.join(app.getPath("userData"), "models");
const settingsFile = () => path.join(app.getPath("userData"), "voice.json");

let ctx = null;          // loaded WhisperContext
let ctxPath = null;
let busy = false;
let state = { phase: "idle", progress: 0, message: "" }; // idle | downloading | loading | ready | error

// Diagnostics: voice.log next to package.json (gitignored), newest at the bottom.
const logFile = () => path.join(app.getAppPath(), "voice.log");
function log(...parts) {
  try { fs.appendFileSync(logFile(), `${new Date().toISOString()} ${parts.map(p => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")}\n`); } catch { /* read-only folder */ }
}

function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), "utf8")); } catch { return {}; } }
function writeSettings(s) { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); }

/** Chosen model: one of MODELS, or "custom" (a file picked by hand). Older settings with only modelPath count as custom. */
function chosen() {
  const s = readSettings();
  if (s.model === "custom" || (!s.model && s.modelPath)) return s.modelPath && fs.existsSync(s.modelPath) ? "custom" : DEFAULT_MODEL;
  return MODELS[s.model] ? s.model : DEFAULT_MODEL;
}
/** Fast listening: whisper encodes only as much audio as we send instead of a fixed 30 s. */
const fast = () => readSettings().fast !== false;
const fileOf = id => path.join(modelDir(), MODELS[id].file);
function modelPath() {
  const id = chosen();
  return id === "custom" ? readSettings().modelPath : fileOf(id);
}
const sizeOk = (file, min) => { try { return fs.statSync(file).size > min; } catch { return false; } };
const haveModel = () => sizeOk(modelPath(), 10e6);

// Engine builds to try, fastest first: the Vulkan build runs on the graphics card (Windows, Linux),
// the plain build on the CPU.
function engines() {
  const base = `@fugood/node-whisper-${process.platform}-${process.arch}`;
  const list = [];
  if (process.platform !== "darwin") list.push({ pkg: `${base}-vulkan`, gpu: true, label: "GPU (Vulkan)" });
  list.push({ pkg: base, gpu: process.platform === "darwin", label: process.platform === "darwin" ? "GPU (Metal)" : "CPU" });
  return list;
}
function engine() {
  const errors = [];
  for (const c of engines()) {
    try { return { ...c, mod: require(c.pkg) }; } catch (e) { errors.push(String(e && e.message || e)); }
  }
  return { mod: null, pkg: engines().at(-1).pkg, error: errors.join(" | ") };
}

function broadcast() {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send("voice:state", status());
}
function set(phase, progress = 0, message = "") {
  if (phase !== state.phase || phase === "error") log("state", phase, message);
  state = { phase, progress, message }; broadcast();
}

function status() {
  const e = engine();
  return {
    engine: !!e.mod,
    engineError: e.mod ? "" : `whisper.cpp engine ${e.pkg} not found. Run npm install.`,
    model: haveModel(),
    device, passMs,
    modelPath: modelPath(),
    modelName: path.basename(modelPath() || ""),
    modelId: chosen(),
    models: Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label, mb: m.mb, note: m.note, downloaded: sizeOk(fileOf(id), 10e6) })),
    fast: fast(),
    ...state,
    phase: ctx && state.phase !== "error" ? "ready" : state.phase,
  };
}

async function download(id) {
  const MODEL = MODELS[id];
  const dest = fileOf(id);
  fs.mkdirSync(modelDir(), { recursive: true });
  const part = dest + ".part";
  set("downloading", 0, `Downloading the ${MODEL.label} speech model…`);
  const res = await fetch(HF + MODEL.file);
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length")) || MODEL.mb * 1e6;
  const out = fs.createWriteStream(part);
  let got = 0, lastSent = 0;
  for await (const chunk of res.body) {
    got += chunk.length;
    if (!out.write(chunk)) await new Promise(r => out.once("drain", r));
    if (got - lastSent > 2e6) { lastSent = got; set("downloading", got / total, `Downloading the ${MODEL.label} speech model… ${Math.round(got / 1e6)} of ${Math.round(total / 1e6)} MB`); }
  }
  await new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve())));
  if (fs.statSync(part).size < MODEL.minBytes) throw new Error("The download was cut short. Please try again.");
  fs.renameSync(part, dest);
}

let device = "";
let passMs = 0;
let loading = false; // log whisper's info lines only while loading (they say which backend it uses)
async function load() {
  const p = modelPath();
  if (ctx && ctxPath === p) return;
  if (ctx) { try { await ctx.release(); } catch { /* already gone */ } ctx = null; }
  set("loading", 0, "Loading the speech model…");
  const tried = [];
  for (const c of engines()) {
    let mod;
    try { mod = require(c.pkg); } catch { continue; }
    try {
      log("loading", p, fs.existsSync(p) ? fs.statSync(p).size : "missing", c.pkg, require(`${c.pkg}/package.json`).version);
      try {
        mod.WhisperContext.toggleNativeLog(true, (level, text) => {
          if (loading || (level !== "info" && level !== "debug")) log("whisper", level, String(text).trim());
        });
      } catch { /* older addon */ }
      loading = true;
      const next = await new mod.WhisperContext({ filePath: p, useGpu: c.gpu });
      // One timed pass: whisper always encodes 30 s of audio, so this is the cost of every pass.
      set("loading", 0.5, `Measuring speed on the ${c.label}…`);
      // The first pass also warms up the engine (GPU shaders), so time the second one.
      const quiet = () => next.transcribeData(new Int16Array(16000 * LISTEN_SECS).buffer, { language: "en", temperature: 0, temperatureInc: 0, maxThreads: threads(), ...ctxFor(16000 * LISTEN_SECS) }).promise;
      await quiet();
      const t0 = Date.now();
      await quiet();
      passMs = Date.now() - t0;
      loading = false;
      log("speed", { device: c.label, passMs, model: path.basename(p), fast: fast() });
      ctx = next; ctxPath = p; device = c.label;
      set("ready", 1, "");
      return;
    } catch (err) {
      loading = false;
      tried.push(`${c.label}: ${String(err && err.message || err)}`);
      log("engine failed", c.pkg, String(err && err.stack || err));
    }
  }
  throw new Error(tried.length ? `Could not start whisper.cpp. ${tried.join(" · ")}` : "whisper.cpp engine not installed. Run npm ci.");
}
const threads = () => Math.max(1, Math.min(8, os.cpus().length - 1));

// whisper.cpp's encoder looks at 1500 positions (30 s, 20 ms each) unless told otherwise.
// A listen is 4 s, so in fast mode we ask for just enough positions (rounded up to 64, plus
// a margin): the encoder then does a fraction of the work. Off = the full 30 s, as before.
const LISTEN_SECS = 4;
const ctxFor = samples => (fast() ? { audioCtx: Math.min(1500, Math.ceil((samples / 16000) * 50 / 64 + 1) * 64) } : {});

async function setup() {
  try {
    const id = chosen();
    if (!haveModel()) {
      if (id === "custom") throw new Error("The model file you picked is missing. Choose it again.");
      await download(id);
    }
    await load();
  } catch (err) {
    ctx = null;
    set("error", 0, String(err && err.message || err));
  }
  return status();
}

/** pcm: 16-bit mono 16 kHz samples. prompt: the script text around the speaker, to bias recognition. */
let busySince = 0;
let skipped = 0;
async function transcribe(pcm, prompt) {
  if (!ctx) { log("transcribe: no model loaded"); return null; }
  if (busy) {
    if (++skipped % 20 === 0) log("still busy with the previous pass", { forMs: Date.now() - busySince });
    return null;
  }
  const buf = pcm instanceof ArrayBuffer ? pcm : pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
  const samples = new Int16Array(buf);
  if (samples.length < 16000) return { text: "", ms: 0 }; // under 1 s: nothing whisper can use
  busy = true; busySince = Date.now(); skipped = 0;
  const t0 = Date.now();
  let peak = 0; for (let i = 0; i < samples.length; i += 8) peak = Math.max(peak, Math.abs(samples[i]));
  try {
    const { promise, stop } = ctx.transcribeData(buf, {
      language: "en",
      temperature: 0,
      temperatureInc: 0, // no slow retries at higher temperatures: the next pass comes soon anyway
      maxThreads: threads(),
      prompt: prompt || undefined,
      ...ctxFor(samples.length),
    });
    // A 4 s window should take well under a second. If a pass runs away, ask it to stop.
    const guard = setTimeout(() => { log("pass too slow, stopping it", { secs: samples.length / 16000 }); void stop(); }, 30000);
    const r = await promise.finally(() => clearTimeout(guard));
    log("heard", { ms: Date.now() - t0, secs: +(samples.length / 16000).toFixed(2), peak, text: r.result });
    return { text: r.result || "", ms: Date.now() - t0 };
  } catch (err) {
    log("transcribe error", String(err && err.stack || err));
    return { text: "", ms: 0, error: String(err && err.message || err) };
  } finally {
    busy = false;
  }
}

function register() {
  log("app start", process.platform, process.arch, "electron", process.versions.electron);
  ipcMain.handle("voice:status", () => status());
  ipcMain.handle("voice:log", (_e, ...parts) => { log("ui", ...parts); });
  ipcMain.handle("voice:setup", () => setup());
  ipcMain.handle("voice:transcribe", (_e, pcm, prompt) => transcribe(pcm, prompt));
  ipcMain.handle("voice:pickModel", async () => {
    const res = await dialog.showOpenDialog({
      title: "Choose a whisper.cpp model (ggml-*.bin)",
      filters: [{ name: "whisper.cpp model", extensions: ["bin"] }],
      properties: ["openFile"],
    });
    if (res.canceled || !res.filePaths[0]) return status();
    writeSettings({ ...readSettings(), model: "custom", modelPath: res.filePaths[0] });
    return setup();
  });
  // Pick one of the built-in models: downloads it if needed, then loads it and measures its speed.
  ipcMain.handle("voice:choose", (_e, id) => {
    if (!MODELS[id]) return status();
    writeSettings({ ...readSettings(), model: id });
    return setup();
  });
  // Fast listening on/off: reload so the speed is measured again.
  ipcMain.handle("voice:fast", async (_e, on) => {
    writeSettings({ ...readSettings(), fast: !!on });
    if (ctx) { try { await ctx.release(); } catch { /* gone */ } ctx = null; ctxPath = null; }
    return setup();
  });
}

module.exports = { register, transcribe, load, status };
