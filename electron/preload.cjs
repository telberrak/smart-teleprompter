const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("teleprompter", {
  openScript: () => ipcRenderer.invoke("script:open"),
  reopenScript: (file, slides) => ipcRenderer.invoke("script:reopen", file, slides),
  openSlides: () => ipcRenderer.invoke("slides:open"),
  saveScript: (file, content) => ipcRenderer.invoke("script:save", file, content),
  takes: {
    begin: scriptPath => ipcRenderer.invoke("take:begin", scriptPath),
    chunk: (id, data) => ipcRenderer.invoke("take:chunk", id, data),
    end: (id, meta) => ipcRenderer.invoke("take:end", id, meta),
    reveal: file => ipcRenderer.invoke("take:reveal", file),
    pickBackground: () => ipcRenderer.invoke("camera:pickBackground"),
    readBackground: file => ipcRenderer.invoke("camera:readBackground", file),
    remove: (scriptPath, files) => ipcRenderer.invoke("take:delete", scriptPath, files),
    getReview: scriptPath => ipcRenderer.invoke("review:get", scriptPath),
    setReview: (scriptPath, state) => ipcRenderer.invoke("review:set", scriptPath, state),
    list: scriptPath => ipcRenderer.invoke("takes:list", scriptPath),
    exportCut: (scriptPath, segs, opts) => ipcRenderer.invoke("export:run", scriptPath, segs, opts),
    exportWhiteboard: (scriptPath, segs, opts) => ipcRenderer.invoke("export:whiteboard", scriptPath, segs, opts),
    productionCut: (scriptPath, segs) => ipcRenderer.invoke("production:cut", scriptPath, segs),
    pickMusic: () => ipcRenderer.invoke("production:pickMusic"),
    exportProduction: (scriptPath, segs, opts) => ipcRenderer.invoke("production:export", scriptPath, segs, opts),
    cutStatus: (scriptPath, segs) => ipcRenderer.invoke("production:cutStatus", scriptPath, segs),
    productionFiles: scriptPath => ipcRenderer.invoke("production:files", scriptPath),
    deleteProduction: scriptPath => ipcRenderer.invoke("production:delete", scriptPath),
    exportShort: (scriptPath, segs, opts) => ipcRenderer.invoke("production:short", scriptPath, segs, opts),
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
    choose: id => ipcRenderer.invoke("voice:choose", id),
    setFast: on => ipcRenderer.invoke("voice:fast", on),
    log: (...parts) => ipcRenderer.invoke("voice:log", ...parts),
    transcribe: (pcm, prompt) => ipcRenderer.invoke("voice:transcribe", pcm, prompt),
    onState: cb => {
      const h = (_e, s) => cb(s);
      ipcRenderer.on("voice:state", h);
      return () => ipcRenderer.removeListener("voice:state", h);
    },
  },
});
