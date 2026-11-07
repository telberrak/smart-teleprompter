// Recording, main process side: takes are streamed to disk next to the script, in
// <script folder>/takes/<script name>/take-01.webm + take-01.json (sentence timings).
const { app, ipcMain, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const open = new Map(); // id -> { stream, file, bytes }
let nextId = 1;

function takesDir(scriptPath) {
  if (scriptPath) {
    const base = path.basename(scriptPath).replace(/\.[^.]+$/, "");
    return path.join(path.dirname(scriptPath), "takes", base);
  }
  return path.join(app.getPath("videos"), "Smart Teleprompter", "takes");
}

/** Review choices (picks, locks, hidden reads), kept next to the takes so they survive restarts. */
const reviewFile = dir => path.join(dir, "review.json");
function readReview(dir) {
  try { return JSON.parse(fs.readFileSync(reviewFile(dir), "utf8")); } catch { return null; }
}
function writeReview(dir, state) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(reviewFile(dir), JSON.stringify(state, null, 2));
}

function nextTakeNumber(dir) {
  // Never reuse a deleted take's number: choices saved for it must not land on a new recording.
  let n = readReview(dir)?.lastTake ?? 0;
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const m = /^take-(\d+)\.webm$/.exec(f);
    if (m) n = Math.max(n, +m[1]);
  }
  return n + 1;
}

function register() {
  ipcMain.handle("take:begin", (_e, scriptPath) => {
    const dir = takesDir(scriptPath);
    fs.mkdirSync(dir, { recursive: true });
    const n = nextTakeNumber(dir);
    const file = path.join(dir, `take-${String(n).padStart(2, "0")}.webm`);
    writeReview(dir, { picks: {}, hidden: [], ...readReview(dir), lastTake: n });
    const id = nextId++;
    open.set(id, { stream: fs.createWriteStream(file), file, bytes: 0 });
    return { id, file, take: n };
  });
  ipcMain.handle("take:chunk", (_e, id, data) => {
    const t = open.get(id);
    if (!t) return false;
    const buf = Buffer.from(data instanceof ArrayBuffer ? data : data.buffer);
    t.bytes += buf.length;
    return new Promise(resolve => { if (t.stream.write(buf)) resolve(true); else t.stream.once("drain", () => resolve(true)); });
  });
  ipcMain.handle("take:end", async (_e, id, meta) => {
    const t = open.get(id);
    if (!t) return null;
    open.delete(id);
    await new Promise(resolve => t.stream.end(resolve));
    const json = t.file.replace(/\.webm$/, ".json");
    fs.writeFileSync(json, JSON.stringify({ video: path.basename(t.file), bytes: t.bytes, ...meta }, null, 2));
    return { file: t.file, json, bytes: t.bytes };
  });
  ipcMain.handle("take:reveal", (_e, file) => { shell.showItemInFolder(file); });
  // Background picture for the camera: copied into the app's own folder so it stays available.
  ipcMain.handle("camera:pickBackground", async () => {
    const r = await dialog.showOpenDialog({ title: "Choose a background picture", properties: ["openFile"],
      filters: [{ name: "Pictures", extensions: ["jpg", "jpeg", "png", "webp"] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const dir = path.join(app.getPath("userData"), "backgrounds");
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, path.basename(r.filePaths[0]));
    if (path.resolve(dest) !== path.resolve(r.filePaths[0])) fs.copyFileSync(r.filePaths[0], dest);
    return dest;
  });
  ipcMain.handle("camera:readBackground", (_e, file) => {
    const dir = path.resolve(path.join(app.getPath("userData"), "backgrounds"));
    const p = path.resolve(file);
    if (path.dirname(p) !== dir || !fs.existsSync(p)) return null;
    return fs.readFileSync(p);
  });
  ipcMain.handle("review:get", (_e, scriptPath) => readReview(takesDir(scriptPath)));
  ipcMain.handle("review:set", (_e, scriptPath, state) => {
    const dir = takesDir(scriptPath), prev = readReview(dir);
    writeReview(dir, { ...state, lastTake: Math.max(prev?.lastTake ?? 0, state.lastTake ?? 0) });
    return true;
  });
  // Deleting a take sends its video and timings to the Recycle Bin (it can be restored from there).
  ipcMain.handle("take:delete", async (_e, scriptPath, files) => {
    const dir = path.resolve(takesDir(scriptPath));
    for (const f of files) {
      const p = path.resolve(f);
      if (path.dirname(p) !== dir || !/^take-\d+\.webm$/.test(path.basename(p))) throw new Error("Not a take: " + f);
      for (const x of [p, p.replace(/\.webm$/, ".json"), p.replace(/\.webm$/, ".fixing.webm")]) if (fs.existsSync(x)) await shell.trashItem(x);
    }
    return true;
  });
}

module.exports = { register, takesDir, readReview, writeReview };
