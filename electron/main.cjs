// Electron main process: one window, plus file access for scripts.
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");

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
  return { path: file, name: path.basename(file), content: await fs.readFile(file, "utf8") };
});

ipcMain.handle("script:save", async (_e, file, content) => {
  if (typeof file !== "string" || !/\.(md|txt)$/i.test(file)) throw new Error("Only .md or .txt scripts can be saved");
  await fs.writeFile(file, content, "utf8");
  return true;
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
