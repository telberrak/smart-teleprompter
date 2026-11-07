const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("teleprompter", {
  openScript: () => ipcRenderer.invoke("script:open"),
  openSlides: () => ipcRenderer.invoke("slides:open"),
  saveScript: (file, content) => ipcRenderer.invoke("script:save", file, content),
  takes: {
    begin: scriptPath => ipcRenderer.invoke("take:begin", scriptPath),
    chunk: (id, data) => ipcRenderer.invoke("take:chunk", id, data),
    end: (id, meta) => ipcRenderer.invoke("take:end", id, meta),
    reveal: file => ipcRenderer.invoke("take:reveal", file),
    list: scriptPath => ipcRenderer.invoke("takes:list", scriptPath),
    exportCut: (scriptPath, segs, opts) => ipcRenderer.invoke("export:run", scriptPath, segs, opts),
    onExportProgress: cb => {
      const h = (_e, p) => cb(p);
      ipcRenderer.on("export:progress", h);
      return () => ipcRenderer.removeListener("export:progress", h);
    },
  },
  voice: {
    status: () => ipcRenderer.invoke("voice:status"),
    setup: () => ipcRenderer.invoke("voice:setup"),
    pickModel: () => ipcRenderer.invoke("voice:pickModel"),
    log: (...parts) => ipcRenderer.invoke("voice:log", ...parts),
    transcribe: (pcm, prompt) => ipcRenderer.invoke("voice:transcribe", pcm, prompt),
    onState: cb => {
      const h = (_e, s) => cb(s);
      ipcRenderer.on("voice:state", h);
      return () => ipcRenderer.removeListener("voice:state", h);
    },
  },
});
