const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("teleprompter", {
  openScript: () => ipcRenderer.invoke("script:open"),
  openSlides: () => ipcRenderer.invoke("slides:open"),
  saveScript: (file, content) => ipcRenderer.invoke("script:save", file, content),
  voice: {
    status: () => ipcRenderer.invoke("voice:status"),
    setup: () => ipcRenderer.invoke("voice:setup"),
    pickModel: () => ipcRenderer.invoke("voice:pickModel"),
    transcribe: (pcm, prompt) => ipcRenderer.invoke("voice:transcribe", pcm, prompt),
    onState: cb => {
      const h = (_e, s) => cb(s);
      ipcRenderer.on("voice:state", h);
      return () => ipcRenderer.removeListener("voice:state", h);
    },
  },
});
