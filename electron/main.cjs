// Electron main process: one window, plus file access for scripts.
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const voice = require("./voice.cjs");
const takes = require("./takes.cjs");
const media = require("./media.cjs");
const production = require("./production.cjs");
media.registerScheme();

const isDev = process.argv.includes("--dev");

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0c0f14",
    title: "Smart Teleprompter",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (isDev) win.loadURL("http://localhost:5173");
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

// The script and slides you worked on last, kept by the app itself (survives restarts,
// dev and built versions alike).
const lastFile = () => path.join(app.getPath("userData"), "last-script.json");
function readLast() {
  try { const v = JSON.parse(fsSync.readFileSync(lastFile(), "utf8")); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
function writeLast(patch) {
  try { fsSync.writeFileSync(lastFile(), JSON.stringify({ ...readLast(), ...patch }, null, 2)); } catch { /* read-only profile */ }
}

ipcMain.handle("script:open", async () => {
  const res = await dialog.showOpenDialog({
    title: "Open a whiteboard script",
    filters: [{ name: "Markdown script", extensions: ["md", "txt"] }],
    properties: ["openFile"],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const file = res.filePaths[0];
  const slides = await findSlides(file);
  writeLast({ path: file, slides: slides?.path ?? null });
  return { path: file, name: path.basename(file), content: await fs.readFile(file, "utf8"), slides };
});

// The slides that belong to a script: 1.1-whiteboard-script.md -> 1.1-slides.excalidraw,
// else the only .excalidraw file in the same folder.
async function findSlides(scriptFile) {
  const dir = path.dirname(scriptFile);
  const base = path.basename(scriptFile).replace(/\.[^.]+$/, "");
  const prefix = (base.match(/^(.*?)-(whiteboard|script)/) ?? [null, base])[1];
  const all = (await fs.readdir(dir)).filter(f => f.toLowerCase().endsWith(".excalidraw"));
  const pickName = all.find(f => f.startsWith(prefix + "-")) ?? (all.length === 1 ? all[0] : null);
  if (!pickName) return null;
  const file = path.join(dir, pickName);
  return { path: file, name: pickName, content: await fs.readFile(file, "utf8") };
}

ipcMain.handle("slides:open", async () => {
  const res = await dialog.showOpenDialog({
    title: "Open Excalidraw slides",
    filters: [{ name: "Excalidraw", extensions: ["excalidraw", "json"] }],
    properties: ["openFile"],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const file = res.filePaths[0];
  writeLast({ slides: file });
  return { path: file, name: path.basename(file), content: await fs.readFile(file, "utf8") };
});

// Reopen the last script (and the slides you used with it) when the app starts.
// What the app saved wins over what the page remembers (the page's memory differs between dev and built).
ipcMain.handle("script:reopen", async (_e, file, slidesFile) => {
  const saved = readLast();
  if (typeof saved.path === "string") { file = saved.path; slidesFile = saved.slides; }
  if (typeof file !== "string" || !/\.(md|txt)$/i.test(file)) return null;
  try {
    const content = await fs.readFile(file, "utf8");
    let slides = null;
    if (typeof slidesFile === "string" && /\.(excalidraw|json)$/i.test(slidesFile)) {
      try { slides = { path: slidesFile, name: path.basename(slidesFile), content: await fs.readFile(slidesFile, "utf8") }; } catch { /* moved */ }
    }
    slides = slides ?? await findSlides(file);
    writeLast({ path: file, slides: slides?.path ?? null });
    return { path: file, name: path.basename(file), content, slides };
  } catch { return null; } // moved or deleted: start as before
});

ipcMain.handle("script:save", async (_e, file, content) => {
  if (typeof file !== "string" || !/\.(md|txt)$/i.test(file)) throw new Error("Only .md or .txt scripts can be saved");
  await fs.writeFile(file, content, "utf8");
  return true;
});

voice.register();
takes.register();
media.register();
production.register();

app.whenReady().then(() => {
  media.registerProtocol();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
