// Electron main process: one window, plus file access for scripts.
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const voice = require("./voice.cjs");

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

ipcMain.handle("script:open", async () => {
  const res = await dialog.showOpenDialog({
    title: "Open a whiteboard script",
    filters: [{ name: "Markdown script", extensions: ["md", "txt"] }],
    properties: ["openFile"],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const file = res.filePaths[0];
  return { path: file, name: path.basename(file), content: await fs.readFile(file, "utf8"), slides: await findSlides(file) };
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
  return { path: file, name: path.basename(file), content: await fs.readFile(file, "utf8") };
});

ipcMain.handle("script:save", async (_e, file, content) => {
  if (typeof file !== "string" || !/\.(md|txt)$/i.test(file)) throw new Error("Only .md or .txt scripts can be saved");
  await fs.writeFile(file, content, "utf8");
  return true;
});

voice.register();

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
