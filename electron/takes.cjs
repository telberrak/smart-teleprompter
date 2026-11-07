// Recording, main process side: takes are streamed to disk next to the script, in
// <script folder>/takes/<script name>/take-01.webm + take-01.json (sentence timings).
const { app, ipcMain, shell } = require("electron");
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

function nextTakeNumber(dir) {
  let n = 0;
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
}

module.exports = { register, takesDir };
